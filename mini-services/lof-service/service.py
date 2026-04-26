#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LOF基金数据服务 - 多数据源获取
主数据源: efinance
备用数据源: HTTP请求（东方财富/天天基金网API）
"""

import json
import re
import urllib.request
import urllib.error
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS

# 尝试导入efinance
try:
    import efinance as ef

    EFINANCE_AVAILABLE = True
except Exception as e:
    print(f"efinance导入失败: {e}")
    EFINANCE_AVAILABLE = False

app = Flask(__name__)
CORS(app)

# ============== 备用数据源（HTTP请求） ==============


class BackupDataSource:
    """备用数据源 - 直接HTTP请求"""

    HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": "https://fund.eastmoney.com/",
    }

    @staticmethod
    def fetch_url(url, timeout=20, max_retries=5):
        """通用HTTP请求，带重试机制，使用curl命令作为主要方式"""
        import time
        import subprocess

        for attempt in range(max_retries):
            try:
                # 使用curl命令，更稳定
                result = subprocess.run(
                    [
                        "curl",
                        "-s",
                        "--connect-timeout",
                        str(timeout),
                        "-m",
                        str(timeout + 5),
                        url,
                    ],
                    capture_output=True,
                    text=True,
                    timeout=timeout + 10,
                )
                if result.returncode == 0 and result.stdout:
                    return result.stdout
                else:
                    print(
                        f"curl请求失败(尝试{attempt + 1}/{max_retries}): returncode={result.returncode}"
                    )
            except subprocess.TimeoutExpired:
                print(f"curl请求超时(尝试{attempt + 1}/{max_retries}): {url}")
            except Exception as e:
                print(
                    f"curl请求失败(尝试{attempt + 1}/{max_retries}): {url}, 错误: {e}"
                )

            if attempt < max_retries - 1:
                time.sleep(2)  # 等待2秒后重试

        # 如果curl失败，尝试使用requests
        try:
            response = requests.get(
                url, headers=BackupDataSource.HEADERS, timeout=timeout
            )
            if response.status_code == 200:
                return response.text
        except Exception as e:
            print(f"requests请求也失败: {e}")

        return None

    @staticmethod
    def get_fund_nav_history(fund_code: str, count: int = 30) -> list:
        """通过天天基金网获取基金净值历史"""
        try:
            # 天天基金网历史净值API
            url = f"https://fund.eastmoney.com/f10/F10DataApi.aspx?type=lsjz&code={fund_code}&page=1&sdate=&edate=&per={count}"
            html = BackupDataSource.fetch_url(url)

            if not html:
                return []

            result = []
            # 解析HTML表格中的净值数据
            # 格式: <td>2024-01-15</td><td class='tor bold'>0.8750</td><td>1.2340</td>
            pattern = r"<td>(\d{4}-\d{2}-\d{2})</td>\s*<td[^>]*>([\d.]+)</td>\s*<td[^>]*>([\d.]+)</td>\s*<td[^>]*>([+-]?[\d.]+)?%?</td>"
            matches = re.findall(pattern, html)

            for match in matches:
                date, nav, accumulated_nav, growth = match
                result.append(
                    {
                        "date": date,
                        "nav": float(nav) if nav else None,
                        "accumulated_nav": float(accumulated_nav)
                        if accumulated_nav
                        else None,
                        "daily_growth": float(growth) if growth else None,
                    }
                )

            return result
        except Exception as e:
            print(f"备用源获取净值历史失败: {e}")
            return []

    @staticmethod
    def get_fund_realtime_nav(fund_code: str) -> dict:
        """通过天天基金网获取实时净值估算"""
        try:
            # 天天基金实时净值API
            url = f"https://fundgz.1234567.com.cn/js/{fund_code}.js?rt={int(__import__('time').time() * 1000)}"
            text = BackupDataSource.fetch_url(url)

            if not text:
                return {}

            # 解析JSONP: jsonpgz({"fundcode":"161725",...})
            match = re.search(r"jsonpgz\((\{.*?\})\)", text)
            if match:
                data = json.loads(match.group(1))
                return {
                    "code": data.get("fundcode", ""),
                    "name": data.get("name", ""),
                    "date": data.get("jzrq", ""),  # 净值日期
                    "nav": float(data.get("dwjz", 0)),  # 单位净值
                    "estimated_nav": float(data.get("gsz", 0)),  # 估算净值
                    "estimated_growth": float(data.get("gszzl", 0)),  # 估算增长率
                    "estimate_time": data.get("gztime", ""),  # 估算时间
                }
            return {}
        except Exception as e:
            print(f"备用源获取实时净值失败: {e}")
            return {}

    @staticmethod
    def get_stock_quote(code: str) -> dict:
        """获取股票/LOF实时行情"""
        try:
            # 判断市场 - 使用数字代码
            # 深圳市场: 0, 上海市场: 1
            # 沪市LOF: 50开头, 深市LOF: 16开头
            # 沪市股票: 6开头, 沪市指数: 000, 9开头
            if code.startswith("50") or code.startswith(("6", "9")):
                market = "1"  # 上海
            else:
                market = "0"  # 深圳

            secid = f"{market}.{code}"

            # 东方财富行情API
            url = f"https://push2.eastmoney.com/api/qt/stock/get?secid={secid}&fields=f57,f58,f43,f169,f170,f46,f44,f51,f168,f47,f48,f60,f45,f52,f50,f49&ut=fa5fd1943c7b386f172d6893dbfba10b"
            text = BackupDataSource.fetch_url(url)

            if not text:
                return {}

            data = json.loads(text)
            if data.get("data"):
                d = data["data"]

                # LOF基金价格通常小于10，需要除以1000
                # 普通股票价格通常大于1，需要除以100
                raw_price = d.get("f43", 0)
                # 判断是否为LOF（代码以1开头的深圳基金）
                is_lof = code.startswith("16") or code.startswith("50")
                price_divisor = 1000 if is_lof else 100

                return {
                    "code": str(d.get("f57", code)),
                    "name": str(d.get("f58", "")),
                    "price": raw_price / price_divisor,
                    "change_percent": d.get("f170", 0) / 100,  # 涨跌幅
                    "change": d.get("f169", 0) / price_divisor,  # 涨跌额
                    "open": d.get("f46", 0) / price_divisor,  # 开盘价
                    "high": d.get("f44", 0) / price_divisor,  # 最高价
                    "low": d.get("f51", 0) / price_divisor,  # 最低价
                    "volume": d.get("f47", 0),  # 成交量
                    "amount": d.get("f48", 0),  # 成交额
                    "prev_close": d.get("f60", 0) / price_divisor,  # 昨收
                    "update_time": "",
                }
            return {}
        except Exception as e:
            print(f"备用源获取行情失败: {e}")
            return {}

    @staticmethod
    def get_stock_kline(code: str, count: int = 30) -> list:
        """获取K线数据"""
        try:
            # 沪市LOF: 50开头, 深市LOF: 16开头
            # 沪市股票: 6开头, 沪市指数: 000, 9开头
            if code.startswith("50") or code.startswith(("6", "9")):
                market = "1"  # 上海
            else:
                market = "0"  # 深圳

            secid = f"{market}.{code}"

            # 东方财富K线API (价格直接返回，无需除以系数)
            url = f"https://push2his.eastmoney.com/api/qt/stock/kline/get?secid={secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&end=20500101&lmt={count}"
            text = BackupDataSource.fetch_url(url)

            if not text:
                return []

            data = json.loads(text)
            if data.get("data") and data["data"].get("klines"):
                result = []
                for item in data["data"]["klines"]:
                    parts = item.split(",")
                    result.append(
                        {
                            "date": parts[0],
                            "open": float(parts[1]) if len(parts) > 1 else None,
                            "close": float(parts[2]) if len(parts) > 2 else None,
                            "high": float(parts[3]) if len(parts) > 3 else None,
                            "low": float(parts[4]) if len(parts) > 4 else None,
                            "volume": float(parts[5]) if len(parts) > 5 else None,
                            "amount": float(parts[6]) if len(parts) > 6 else None,
                            "change_percent": None,
                        }
                    )
                return result[::-1]  # 按日期升序
            return []
        except Exception as e:
            print(f"备用源获取K线失败: {e}")
            return []

    # 指数代码映射表 - 用于统一不同来源的指数代码
    INDEX_CODE_MAP = {
        # 港股指数
        "HSI": "HSI",  # 恒生指数
        "HSCEI": "HSCEI",  # 恒生中国企业指数
        "HSTECH": "HSTECH",  # 恒生科技指数
        "HSMEI": "HSMEI",  # 恒生综合指数
        "HSCCI": "HSCCI",  # 恒生中国国企指数
        "HSHKI": "HSHKI",  # 港股通高股息
        # 美股指数
        "NDX": "NDX",  # 纳斯达克100
        "SPX": "SPX",  # 标普500
        "DJI": "DJI",  # 道琼斯工业平均
        "IXIC": "IXIC",  # 纳斯达克综合
        "RUT": "RUT",  # 罗素2000
        "VIX": "VIX",  # 波动率指数
        # A股主要指数（常用别名）
        "沪深300": "000300",
        "上证指数": "000001",
        "深证成指": "399001",
        "创业板指": "399006",
        "科创50": "000688",
        "中证500": "000905",
        "中证白酒": "399997",
        "中证医疗": "399989",
        "中证新能源": "399808",
        "中证军工": "399967",
    }

    # 全球指数市场代码映射
    GLOBAL_INDEX_MARKET = {
        # 港股指数 - 使用市场代码 100
        "HSI": "100",
        "HSCEI": "100",
        "HSTECH": "100",
        "HSMEI": "100",
        "HSCCI": "100",
        "HSHKI": "100",
        # 美股指数 - 使用市场代码 100
        "NDX": "100",
        "SPX": "100",
        "DJI": "100",
        "IXIC": "100",
        "RUT": "100",
        "VIX": "100",
        # 国际商品
        "GLNC": "100",  # 黄金
        "CLN": "100",  # 原油
    }

    @staticmethod
    def get_index_kline(index_code: str, count: int = 30) -> list:
        """获取指数历史K线数据"""
        try:
            original_code = index_code

            market = None

            # 统一处理：直接根据代码格式判断市场
            # 沪市: 000/6开头, 深市: 399/0开头, 港股/美股: 其他字母或特殊代码
            if index_code in BackupDataSource.GLOBAL_INDEX_MARKET:
                market = BackupDataSource.GLOBAL_INDEX_MARKET[index_code]
            elif index_code.startswith("000") or index_code.startswith("6"):
                market = "1"  # 上海
            elif index_code.startswith("399") or index_code.startswith("0"):
                market = "0"  # 深圳
            elif index_code.startswith("H") and len(index_code) <= 6:
                market = "100"
            elif index_code.startswith(("N", "S", "D", "I")):
                market = "100"
            elif index_code.isdigit():
                if index_code.startswith("399") or index_code.startswith("00"):
                    market = "0"
                elif index_code.startswith("6") or index_code.startswith("000"):
                    market = "1"
                else:
                    try:
                        int(index_code)
                        market = "0"
                    except:
                        market = "100"
            else:
                market = "100"

            secid = f"{market}.{index_code}"
            print(
                f"获取指数K线: index_code={original_code}, normalized={index_code}, secid={secid}"
            )

            # 获取指数K线数据 - 多获取一天用于计算涨跌幅
            url = f"https://push2his.eastmoney.com/api/qt/stock/kline/get?secid={secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&end=20500101&lmt={count + 1}"
            text = BackupDataSource.fetch_url(url)

            if not text:
                print(f"指数K线API返回空: secid={secid}")
                return []

            data = json.loads(text)
            if data.get("data") and data["data"].get("klines"):
                klines = data["data"]["klines"]
                result = []

                # K线数据是按日期升序返回的（从早到晚）
                # 遍历K线数据，使用前一日收盘价计算涨跌幅
                for i, item in enumerate(klines):
                    parts = item.split(",")
                    date = parts[0]
                    open_price = float(parts[1]) if len(parts) > 1 else None
                    close = float(parts[2]) if len(parts) > 2 else None
                    high = float(parts[3]) if len(parts) > 3 else None
                    low = float(parts[4]) if len(parts) > 4 else None

                    # 计算涨跌幅：使用前一日收盘价（i > 0时才有前一天数据）
                    change_percent = None
                    if i > 0:  # 不是最早的那一天
                        prev_parts = klines[i - 1].split(",")
                        prev_close = (
                            float(prev_parts[2]) if len(prev_parts) > 2 else None
                        )
                        if close and prev_close and prev_close > 0:
                            change_percent = round(
                                (close - prev_close) / prev_close * 100, 2
                            )

                    result.append(
                        {
                            "date": date,
                            "open": open_price,
                            "close": close,
                            "high": high,
                            "low": low,
                            "change_percent": change_percent,
                        }
                    )

                print(
                    f"指数K线获取成功: {len(result)}条记录, 最后一个change_percent={result[-1].get('change_percent') if result else None}"
                )
                return result

            print(f"指数K线数据为空: {data}")
            return []
        except Exception as e:
            print(f"备用源获取指数K线失败: {e}")
            import traceback

            traceback.print_exc()
            return []

    @staticmethod
    def get_index_quote(index_code: str) -> dict:
        """获取指数行情 - 支持A股、港股、美股及国际指数"""
        try:
            # 标准化指数代码
            original_code = index_code
            index_code = BackupDataSource.INDEX_CODE_MAP.get(index_code, index_code)

            market = None

            # 1. 检查是否为全球指数（港股/美股）
            if index_code in BackupDataSource.GLOBAL_INDEX_MARKET:
                market = BackupDataSource.GLOBAL_INDEX_MARKET[index_code]
            # 2. A股指数判断
            elif (
                index_code.startswith("000")
                or index_code.startswith("880")
                or index_code.startswith("9")
            ):
                market = "1"  # 上海
            elif index_code.startswith("399"):
                market = "0"  # 深圳
            # 3. 特殊代码处理
            elif index_code == "AU9999":
                # 黄金现货 - 使用上海黄金交易所代码
                return BackupDataSource._get_gold_price()
            elif index_code.startswith("CLU") or index_code.startswith("CL"):
                # 原油期货
                return BackupDataSource._get_oil_price(index_code)
            elif index_code.startswith("H") and len(index_code) <= 6:
                # 可能是港股指数或港股代码
                market = "100"
            else:
                # 尝试自动判断：纯数字为A股，其他尝试全球市场
                if index_code.isdigit():
                    if index_code.startswith("399") or index_code.startswith("00"):
                        market = "0"  # 深圳
                    elif index_code.startswith("6") or index_code.startswith("000"):
                        market = "1"  # 上海
                    else:
                        market = "0"  # 默认深圳
                else:
                    # 尝试全球指数市场
                    market = "100"

            secid = f"{market}.{index_code}"

            # 全球指数和A股使用相同的API
            url = f"https://push2.eastmoney.com/api/qt/stock/get?secid={secid}&fields=f57,f58,f43,f169,f170,f60&ut=fa5fd1943c7b386f172d6893dbfba10b"

            text = BackupDataSource.fetch_url(url)

            if not text:
                return {}

            data = json.loads(text)
            if data.get("data"):
                d = data["data"]
                # 所有指数价格都需要除以100
                return {
                    "code": str(d.get("f57", original_code)),
                    "name": str(d.get("f58", "")),
                    "price": d.get("f43", 0) / 100,
                    "change_percent": d.get("f170", 0) / 100,
                    "change": d.get("f169", 0) / 100,
                    "prev_close": d.get("f60", 0) / 100,
                    "update_time": "",
                }
            return {}
        except Exception as e:
            print(f"备用源获取指数行情失败: {e}")
            return {}

    @staticmethod
    def _get_gold_price() -> dict:
        """获取黄金现货价格"""
        try:
            # 上海黄金交易所 AU9999
            url = "https://push2.eastmoney.com/api/qt/stock/get?secid=1.AU9999&fields=f57,f58,f43,f169,f170,f60&ut=fa5fd1943c7b386f172d6893dbfba10b"
            text = BackupDataSource.fetch_url(url)

            if not text:
                # 尝试其他黄金代码
                url = "https://push2.eastmoney.com/api/qt/stock/get?secid=142.AU0&fields=f57,f58,f43,f169,f170,f60&ut=fa5fd1943c7b386f172d6893dbfba10b"
                text = BackupDataSource.fetch_url(url)

            if text:
                data = json.loads(text)
                if data.get("data"):
                    d = data["data"]
                    return {
                        "code": "AU9999",
                        "name": "黄金现货",
                        "price": d.get("f43", 0) / 100,
                        "change_percent": d.get("f170", 0) / 100,
                        "change": d.get("f169", 0) / 100,
                        "prev_close": d.get("f60", 0) / 100,
                        "update_time": "",
                    }
            return {}
        except Exception as e:
            print(f"获取黄金价格失败: {e}")
            return {}

    @staticmethod
    def _get_oil_price(index_code: str) -> dict:
        """获取原油期货价格"""
        try:
            # 尝试获取原油期货数据
            # 使用NYMEX原油期货代码
            url = f"https://push2.eastmoney.com/api/qt/stock/get?secid=100.NMCL&fields=f57,f58,f43,f169,f170,f60&ut=fa5fd1943c7b386f172d6893dbfba10b"
            text = BackupDataSource.fetch_url(url)

            if text:
                data = json.loads(text)
                if data.get("data"):
                    d = data["data"]
                    return {
                        "code": index_code,
                        "name": "原油期货",
                        "price": d.get("f43", 0) / 100,
                        "change_percent": d.get("f170", 0) / 100,
                        "change": d.get("f169", 0) / 100,
                        "prev_close": d.get("f60", 0) / 100,
                        "update_time": "",
                    }
            return {}
        except Exception as e:
            print(f"获取原油价格失败: {e}")
            return {}


# ============== 主数据源（efinance） ==============


class EfinanceDataSource:
    """主数据源 - efinance库"""

    @staticmethod
    def get_fund_nav_history(fund_code: str, count: int = 30) -> list:
        """获取基金净值历史"""
        if not EFINANCE_AVAILABLE:
            return []
        try:
            df = ef.fund.get_quote_history(fund_code)
            if df is not None and not df.empty:
                records = df.head(count).to_dict("records")
                result = []
                for r in records:
                    result.append(
                        {
                            "date": str(r.get("日期", "")),
                            "nav": float(r.get("单位净值", 0))
                            if r.get("单位净值")
                            else None,
                            "accumulated_nav": float(r.get("累计净值", 0))
                            if r.get("累计净值")
                            else None,
                            "daily_growth": float(r.get("涨跌幅", 0))
                            if r.get("涨跌幅")
                            else None,
                        }
                    )
                return result
        except Exception as e:
            print(f"efinance获取净值历史失败: {e}")
        return []

    @staticmethod
    def get_stock_quote(code: str) -> dict:
        """获取股票/LOF实时行情"""
        if not EFINANCE_AVAILABLE:
            return {}
        try:
            df = ef.stock.get_latest_quote(code)
            if df is not None and not df.empty:
                r = df.iloc[0]
                return {
                    "code": str(r.get("代码", code)),
                    "name": str(r.get("名称", "")),
                    "price": float(r.get("最新价", 0)),
                    "change_percent": float(r.get("涨跌幅", 0)),
                    "change": float(r.get("涨跌额", 0)),
                    "open": float(r.get("今开", 0)),
                    "high": float(r.get("最高", 0)),
                    "low": float(r.get("最低", 0)),
                    "volume": float(r.get("成交量", 0)),
                    "amount": float(r.get("成交额", 0)),
                    "prev_close": float(r.get("昨收", 0)),
                    "update_time": str(r.get("更新时间", "")),
                }
        except Exception as e:
            print(f"efinance获取行情失败: {e}")
        return {}

    @staticmethod
    def get_stock_kline(code: str, count: int = 30) -> list:
        """获取K线数据"""
        if not EFINANCE_AVAILABLE:
            return []
        try:
            df = ef.stock.get_quote_history(code, limit=count)
            if df is not None and not df.empty:
                records = df.to_dict("records")
                result = []
                for r in records:
                    result.append(
                        {
                            "date": str(r.get("日期", "")),
                            "open": float(r.get("开盘", 0)) if r.get("开盘") else None,
                            "close": float(r.get("收盘", 0)) if r.get("收盘") else None,
                            "high": float(r.get("最高", 0)) if r.get("最高") else None,
                            "low": float(r.get("最低", 0)) if r.get("最低") else None,
                            "volume": float(r.get("成交量", 0))
                            if r.get("成交量")
                            else None,
                            "amount": float(r.get("成交额", 0))
                            if r.get("成交额")
                            else None,
                            "change_percent": float(r.get("涨跌幅", 0))
                            if r.get("涨跌幅")
                            else None,
                        }
                    )
                return result[::-1]
        except Exception as e:
            print(f"efinance获取K线失败: {e}")
        return []

    @staticmethod
    def get_index_quote(index_code: str) -> dict:
        """获取指数行情"""
        if not EFINANCE_AVAILABLE:
            return {}
        try:
            df = ef.stock.get_latest_quote(index_code)
            if df is not None and not df.empty:
                r = df.iloc[0]
                return {
                    "code": str(r.get("代码", index_code)),
                    "name": str(r.get("名称", "")),
                    "price": float(r.get("最新价", 0)),
                    "change_percent": float(r.get("涨跌幅", 0)),
                    "change": float(r.get("涨跌额", 0)),
                    "prev_close": float(r.get("昨收", 0)),
                    "update_time": str(r.get("更新时间", "")),
                }
        except Exception as e:
            print(f"efinance获取指数行情失败: {e}")
        return {}


# ============== 统一数据接口（带主备切换） ==============


class DataSourceManager:
    """数据源管理器 - 主备切换"""

    PRIMARY = "efinance"
    BACKUP = "http"

    @staticmethod
    def get_fund_nav_history(fund_code: str, count: int = 30) -> tuple:
        """获取基金净值历史，返回(数据, 数据源)"""
        # 先尝试主数据源
        result = EfinanceDataSource.get_fund_nav_history(fund_code, count)
        if result and len(result) > 0:
            return result, DataSourceManager.PRIMARY

        # 主数据源失败，尝试备用
        print(f"efinance获取净值失败，切换到备用数据源")
        result = BackupDataSource.get_fund_nav_history(fund_code, count)
        return result, DataSourceManager.BACKUP if result else DataSourceManager.PRIMARY

    @staticmethod
    def get_stock_quote(code: str) -> tuple:
        """获取行情，返回(数据, 数据源)"""
        # 先尝试主数据源
        result = EfinanceDataSource.get_stock_quote(code)
        if result and result.get("price", 0) > 0:
            return result, DataSourceManager.PRIMARY

        # 主数据源失败，尝试备用
        print(f"efinance获取行情失败，切换到备用数据源")
        result = BackupDataSource.get_stock_quote(code)
        return result, DataSourceManager.BACKUP if result else DataSourceManager.PRIMARY

    @staticmethod
    def get_stock_kline(code: str, count: int = 30) -> tuple:
        """获取K线，返回(数据, 数据源)"""
        result = EfinanceDataSource.get_stock_kline(code, count)
        if result and len(result) > 0:
            return result, DataSourceManager.PRIMARY

        print(f"efinance获取K线失败，切换到备用数据源")
        result = BackupDataSource.get_stock_kline(code, count)
        return result, DataSourceManager.BACKUP if result else DataSourceManager.PRIMARY

    @staticmethod
    def get_index_quote(index_code: str) -> tuple:
        """获取指数行情，返回(数据, 数据源)"""
        result = EfinanceDataSource.get_index_quote(index_code)
        if result and result.get("price", 0) > 0:
            return result, DataSourceManager.PRIMARY

        print(f"efinance获取指数行情失败，切换到备用数据源")
        result = BackupDataSource.get_index_quote(index_code)
        return result, DataSourceManager.BACKUP if result else DataSourceManager.PRIMARY

    @staticmethod
    def get_index_kline(index_code: str, count: int = 30) -> tuple:
        """获取指数K线，返回(数据, 数据源)"""
        # 目前只有备用数据源支持指数K线
        result = BackupDataSource.get_index_kline(index_code, count)
        return result, DataSourceManager.BACKUP if result else DataSourceManager.PRIMARY


# ============== LOF追踪指数映射 ==============


def get_lof_tracking_index(fund_code: str) -> dict:
    """根据LOF基金代码推断追踪指数"""
    lof_index_map = {
        # ============== 白酒/消费 ==============
        "161725": {
            "index_code": "399997",
            "index_name": "中证白酒",
            "coefficient": 0.95,
        },
        "161118": {
            "index_code": "000932",
            "index_name": "中证主要消费",
            "coefficient": 0.95,
        },
        "160222": {
            "index_code": "000932",
            "index_name": "中证主要消费",
            "coefficient": 0.95,
        },
        # ============== 原油/能源 ==============
        "501018": {
            "index_code": "CLU00",
            "index_name": "原油期货",
            "coefficient": 0.95,
        },
        "161129": {
            "index_code": "CLU00",
            "index_name": "原油期货",
            "coefficient": 0.95,
        },
        "160416": {
            "index_code": "CLU00",
            "index_name": "原油期货",
            "coefficient": 0.95,
        },
        "160723": {
            "index_code": "CLU00",
            "index_name": "原油期货",
            "coefficient": 0.95,
        },
        # ============== 黄金/贵金属 ==============
        "161116": {
            "index_code": "AU9999",
            "index_name": "黄金现货",
            "coefficient": 0.99,
        },
        "164701": {
            "index_code": "AU9999",
            "index_name": "黄金现货",
            "coefficient": 0.99,
        },
        "160719": {
            "index_code": "AU9999",
            "index_name": "黄金现货",
            "coefficient": 0.99,
        },
        "518800": {
            "index_code": "AU9999",
            "index_name": "黄金现货",
            "coefficient": 0.99,
        },
        # ============== 港股指数 ==============
        "161831": {"index_code": "HSI", "index_name": "恒生指数", "coefficient": 0.95},
        "160922": {"index_code": "HSI", "index_name": "恒生指数", "coefficient": 0.95},
        "510900": {"index_code": "HSI", "index_name": "恒生指数", "coefficient": 0.95},
        "159920": {"index_code": "HSI", "index_name": "恒生指数", "coefficient": 0.95},
        "513060": {
            "index_code": "HSTECH",
            "index_name": "恒生科技",
            "coefficient": 0.95,
        },
        "159741": {
            "index_code": "HSTECH",
            "index_name": "恒生科技",
            "coefficient": 0.95,
        },
        "30378": {
            "index_code": "HSTECH",
            "index_name": "恒生科技",
            "coefficient": 0.95,
        },
        "159825": {
            "index_code": "HSCEI",
            "index_name": "恒生国企",
            "coefficient": 0.95,
        },
        "501309": {
            "index_code": "HSHKI",
            "index_name": "港股通高股息",
            "coefficient": 0.95,
        },
        "501311": {
            "index_code": "HSHKI",
            "index_name": "港股通高股息",
            "coefficient": 0.95,
        },
        # ============== 美股指数 ==============
        "161130": {
            "index_code": "NDX",
            "index_name": "纳斯达克100",
            "coefficient": 0.95,
        },
        "159941": {
            "index_code": "NDX",
            "index_name": "纳斯达克100",
            "coefficient": 0.95,
        },
        "513100": {
            "index_code": "NDX",
            "index_name": "纳斯达克100",
            "coefficient": 0.95,
        },
        "513101": {
            "index_code": "NDX",
            "index_name": "纳斯达克100",
            "coefficient": 0.95,
        },
        "161125": {"index_code": "SPX", "index_name": "标普500", "coefficient": 0.95},
        "513500": {"index_code": "SPX", "index_name": "标普500", "coefficient": 0.95},
        "159612": {"index_code": "SPX", "index_name": "标普500", "coefficient": 0.95},
        # ============== 医药/医疗 ==============
        "161035": {
            "index_code": "399989",
            "index_name": "中证医疗",
            "coefficient": 0.95,
        },
        "161122": {
            "index_code": "399989",
            "index_name": "中证医疗",
            "coefficient": 0.95,
        },
        "162412": {
            "index_code": "399989",
            "index_name": "中证医疗",
            "coefficient": 0.95,
        },
        "161727": {
            "index_code": "399989",
            "index_name": "中证医疗",
            "coefficient": 0.95,
        },
        "160219": {
            "index_code": "399932",
            "index_name": "中证医药",
            "coefficient": 0.95,
        },
        "161121": {
            "index_code": "399932",
            "index_name": "中证医药",
            "coefficient": 0.95,
        },
        "512290": {
            "index_code": "399989",
            "index_name": "中证医疗",
            "coefficient": 0.95,
        },
        "159938": {
            "index_code": "399932",
            "index_name": "中证医药",
            "coefficient": 0.95,
        },
        "161036": {
            "index_code": "399989",
            "index_name": "中证医疗",
            "coefficient": 0.95,
        },
        # ============== 新能源/光伏/电动车 ==============
        "161028": {
            "index_code": "399808",
            "index_name": "中证新能源",
            "coefficient": 0.95,
        },
        "160225": {
            "index_code": "399808",
            "index_name": "中证新能源",
            "coefficient": 0.95,
        },
        "161634": {
            "index_code": "399808",
            "index_name": "中证新能源",
            "coefficient": 0.95,
        },
        "516160": {
            "index_code": "399808",
            "index_name": "中证新能源",
            "coefficient": 0.95,
        },
        "159863": {
            "index_code": "931151",
            "index_name": "中证光伏产业",
            "coefficient": 0.95,
        },
        "161728": {
            "index_code": "931151",
            "index_name": "中证光伏产业",
            "coefficient": 0.95,
        },
        "161027": {
            "index_code": "399998",
            "index_name": "中证新能源车",
            "coefficient": 0.95,
        },
        "159806": {
            "index_code": "399998",
            "index_name": "中证新能源车",
            "coefficient": 0.95,
        },
        "515030": {
            "index_code": "399998",
            "index_name": "中证新能源车",
            "coefficient": 0.95,
        },
        "516390": {
            "index_code": "399998",
            "index_name": "中证新能源车",
            "coefficient": 0.95,
        },
        # ============== 军工/国防 ==============
        "161024": {
            "index_code": "399967",
            "index_name": "中证军工",
            "coefficient": 0.95,
        },
        "161624": {
            "index_code": "399967",
            "index_name": "中证军工",
            "coefficient": 0.95,
        },
        "512680": {
            "index_code": "399967",
            "index_name": "中证军工",
            "coefficient": 0.95,
        },
        "160630": {
            "index_code": "399967",
            "index_name": "中证军工",
            "coefficient": 0.95,
        },
        "502003": {
            "index_code": "399967",
            "index_name": "中证军工",
            "coefficient": 0.95,
        },
        # ============== 证券/券商 ==============
        "161720": {
            "index_code": "399975",
            "index_name": "中证全指证券公司",
            "coefficient": 0.95,
        },
        "161627": {
            "index_code": "399975",
            "index_name": "中证全指证券公司",
            "coefficient": 0.95,
        },
        "160417": {
            "index_code": "399975",
            "index_name": "中证全指证券公司",
            "coefficient": 0.95,
        },
        "160625": {
            "index_code": "399975",
            "index_name": "中证全指证券公司",
            "coefficient": 0.95,
        },
        "512880": {
            "index_code": "399975",
            "index_name": "中证全指证券公司",
            "coefficient": 0.95,
        },
        # ============== 银行/金融 ==============
        "161723": {
            "index_code": "399986",
            "index_name": "中证银行",
            "coefficient": 0.95,
        },
        "160418": {
            "index_code": "399986",
            "index_name": "中证银行",
            "coefficient": 0.95,
        },
        "512800": {
            "index_code": "399986",
            "index_name": "中证银行",
            "coefficient": 0.95,
        },
        "161721": {
            "index_code": "000934",
            "index_name": "中证800金融",
            "coefficient": 0.95,
        },
        # ============== 环保/低碳 ==============
        "161038": {
            "index_code": "000827",
            "index_name": "中证环保",
            "coefficient": 0.95,
        },
        "160634": {
            "index_code": "000827",
            "index_name": "中证环保",
            "coefficient": 0.95,
        },
        "161728": {
            "index_code": "931151",
            "index_name": "中证光伏产业",
            "coefficient": 0.95,
        },
        "512580": {
            "index_code": "000827",
            "index_name": "中证环保",
            "coefficient": 0.95,
        },
        # ============== 基建/地产 ==============
        "161726": {
            "index_code": "000022",
            "index_name": "中证基建",
            "coefficient": 0.95,
        },
        "160224": {
            "index_code": "000022",
            "index_name": "中证基建",
            "coefficient": 0.95,
        },
        "165525": {
            "index_code": "000022",
            "index_name": "中证基建",
            "coefficient": 0.95,
        },
        "160628": {
            "index_code": "000022",
            "index_name": "中证基建",
            "coefficient": 0.95,
        },
        "160218": {
            "index_code": "399393",
            "index_name": "国证地产",
            "coefficient": 0.95,
        },
        "160208": {
            "index_code": "399393",
            "index_name": "国证地产",
            "coefficient": 0.95,
        },
        "161724": {
            "index_code": "399393",
            "index_name": "国证地产",
            "coefficient": 0.95,
        },
        # ============== 沪深300 ==============
        "161811": {
            "index_code": "000300",
            "index_name": "沪深300",
            "coefficient": 0.95,
        },
        "160706": {
            "index_code": "000300",
            "index_name": "沪深300",
            "coefficient": 0.95,
        },
        "160616": {
            "index_code": "000300",
            "index_name": "沪深300",
            "coefficient": 0.95,
        },
        "510300": {
            "index_code": "000300",
            "index_name": "沪深300",
            "coefficient": 0.95,
        },
        "159919": {
            "index_code": "000300",
            "index_name": "沪深300",
            "coefficient": 0.95,
        },
        # ============== 中证500 ==============
        "161717": {
            "index_code": "000905",
            "index_name": "中证500",
            "coefficient": 0.95,
        },
        "160617": {
            "index_code": "000905",
            "index_name": "中证500",
            "coefficient": 0.95,
        },
        "510500": {
            "index_code": "000905",
            "index_name": "中证500",
            "coefficient": 0.95,
        },
        "159922": {
            "index_code": "000905",
            "index_name": "中证500",
            "coefficient": 0.95,
        },
        # ============== 创业板 ==============
        "161913": {
            "index_code": "399006",
            "index_name": "创业板指",
            "coefficient": 0.95,
        },
        "159952": {
            "index_code": "399006",
            "index_name": "创业板指",
            "coefficient": 0.95,
        },
        "160420": {
            "index_code": "399006",
            "index_name": "创业板指",
            "coefficient": 0.95,
        },
        "160637": {
            "index_code": "399006",
            "index_name": "创业板指",
            "coefficient": 0.95,
        },
        # ============== 科创板 ==============
        "501082": {"index_code": "000688", "index_name": "科创50", "coefficient": 0.95},
        "588000": {"index_code": "000688", "index_name": "科创50", "coefficient": 0.95},
        "588080": {"index_code": "000688", "index_name": "科创50", "coefficient": 0.95},
        # ============== 有色金属/资源 ==============
        "160620": {
            "index_code": "000979",
            "index_name": "有色金属",
            "coefficient": 0.95,
        },
        "160621": {
            "index_code": "000979",
            "index_name": "有色金属",
            "coefficient": 0.95,
        },
        "512400": {
            "index_code": "000979",
            "index_name": "有色金属",
            "coefficient": 0.95,
        },
        "160622": {
            "index_code": "399435",
            "index_name": "国证有色",
            "coefficient": 0.95,
        },
        "160221": {
            "index_code": "000979",
            "index_name": "有色金属",
            "coefficient": 0.95,
        },
        # ============== 信息安全/科技 ==============
        "161632": {
            "index_code": "399994",
            "index_name": "信息安全",
            "coefficient": 0.95,
        },
        "159737": {
            "index_code": "399994",
            "index_name": "信息安全",
            "coefficient": 0.95,
        },
        "512480": {
            "index_code": "399994",
            "index_name": "信息安全",
            "coefficient": 0.95,
        },
        "161031": {
            "index_code": "399971",
            "index_name": "中证传媒",
            "coefficient": 0.95,
        },
        # ============== 传媒/游戏 ==============
        "161729": {
            "index_code": "399971",
            "index_name": "中证传媒",
            "coefficient": 0.95,
        },
        "160629": {
            "index_code": "399971",
            "index_name": "中证传媒",
            "coefficient": 0.95,
        },
        "159805": {
            "index_code": "399971",
            "index_name": "中证传媒",
            "coefficient": 0.95,
        },
        # ============== 半导体/芯片 ==============
        "512480": {
            "index_code": "399994",
            "index_name": "信息安全",
            "coefficient": 0.95,
        },
        "159813": {
            "index_code": "930998",
            "index_name": "中证芯片",
            "coefficient": 0.95,
        },
        "512760": {
            "index_code": "930998",
            "index_name": "中证芯片",
            "coefficient": 0.95,
        },
        "159995": {
            "index_code": "930998",
            "index_name": "中证芯片",
            "coefficient": 0.95,
        },
        "159801": {
            "index_code": "930998",
            "index_name": "中证芯片",
            "coefficient": 0.95,
        },
        # ============== 互联网/中概 ==============
        "164906": {
            "index_code": "H11136",
            "index_name": "中国互联网50",
            "coefficient": 0.95,
        },
        "159607": {
            "index_code": "H11136",
            "index_name": "中国互联网50",
            "coefficient": 0.95,
        },
        "513050": {
            "index_code": "H11136",
            "index_name": "中国互联网50",
            "coefficient": 0.95,
        },
        "164805": {
            "index_code": "H30533",
            "index_name": "中国互联网",
            "coefficient": 0.95,
        },
        "165513": {
            "index_code": "H30533",
            "index_name": "中国互联网",
            "coefficient": 0.95,
        },
        # ============== 5G/通信 ==============
        "161726": {
            "index_code": "931079",
            "index_name": "中证5G通信",
            "coefficient": 0.95,
        },
        "159994": {
            "index_code": "931079",
            "index_name": "中证5G通信",
            "coefficient": 0.95,
        },
        "515050": {
            "index_code": "931079",
            "index_name": "中证5G通信",
            "coefficient": 0.95,
        },
        "161825": {
            "index_code": "931079",
            "index_name": "中证5G通信",
            "coefficient": 0.95,
        },
        # ============== 人工智能 ==============
        "159819": {
            "index_code": "931071",
            "index_name": "中证人工智能",
            "coefficient": 0.95,
        },
        "515070": {
            "index_code": "931071",
            "index_name": "中证人工智能",
            "coefficient": 0.95,
        },
        "161631": {
            "index_code": "931071",
            "index_name": "中证人工智能",
            "coefficient": 0.95,
        },
        # ============== 煤炭/采掘 ==============
        "161724": {
            "index_code": "399998",
            "index_name": "中证煤炭",
            "coefficient": 0.95,
        },
        "161032": {
            "index_code": "399998",
            "index_name": "中证煤炭",
            "coefficient": 0.95,
        },
        "515220": {
            "index_code": "399998",
            "index_name": "中证煤炭",
            "coefficient": 0.95,
        },
        # ============== 钢铁 ==============
        "160632": {
            "index_code": "930606",
            "index_name": "中证钢铁",
            "coefficient": 0.95,
        },
        "512560": {
            "index_code": "930606",
            "index_name": "中证钢铁",
            "coefficient": 0.95,
        },
        # ============== 银华系列 ==============
        "161810": {
            "index_code": "000300",
            "index_name": "沪深300",
            "coefficient": 0.95,
        },
        "161812": {
            "index_code": "000300",
            "index_name": "沪深300",
            "coefficient": 0.95,
        },
        "161816": {
            "index_code": "000300",
            "index_name": "沪深300",
            "coefficient": 0.95,
        },
        # ============== 国泰系列 ==============
        "160212": {
            "index_code": "000300",
            "index_name": "沪深300",
            "coefficient": 0.95,
        },
        "160213": {
            "index_code": "000905",
            "index_name": "中证500",
            "coefficient": 0.95,
        },
        "160215": {
            "index_code": "000300",
            "index_name": "沪深300",
            "coefficient": 0.95,
        },
        # ============== 华夏系列 ==============
        "160311": {
            "index_code": "000300",
            "index_name": "沪深300",
            "coefficient": 0.95,
        },
        "160312": {
            "index_code": "000300",
            "index_name": "沪深300",
            "coefficient": 0.95,
        },
        "160314": {
            "index_code": "000905",
            "index_name": "中证500",
            "coefficient": 0.95,
        },
        "160317": {
            "index_code": "399006",
            "index_name": "创业板指",
            "coefficient": 0.95,
        },
        # ============== 南方系列 ==============
        "160105": {
            "index_code": "000300",
            "index_name": "沪深300",
            "coefficient": 0.95,
        },
        "160106": {
            "index_code": "000905",
            "index_name": "中证500",
            "coefficient": 0.95,
        },
        "160119": {
            "index_code": "399006",
            "index_name": "创业板指",
            "coefficient": 0.95,
        },
        "160131": {
            "index_code": "399006",
            "index_name": "创业板指",
            "coefficient": 0.95,
        },
    }

    return lof_index_map.get(
        fund_code, {"index_code": None, "index_name": "未知", "coefficient": 0.95}
    )


# ============== API路由 ==============


@app.route("/api/lof/nav", methods=["GET"])
def api_nav():
    """获取最新净值"""
    fund_code = request.args.get("code", "")
    if not fund_code:
        return jsonify({"error": "请提供基金代码"}), 400

    history, source = DataSourceManager.get_fund_nav_history(fund_code, 1)
    if history:
        result = history[0]
        result["data_source"] = source
        return jsonify(result)
    return jsonify({"error": "获取净值失败", "data_source": "none"})


@app.route("/api/lof/nav_history", methods=["GET"])
def api_nav_history():
    """获取历史净值"""
    fund_code = request.args.get("code", "")
    count = int(request.args.get("count", 30))
    if not fund_code:
        return jsonify({"error": "请提供基金代码"}), 400

    result, source = DataSourceManager.get_fund_nav_history(fund_code, count)
    return jsonify({"data": result, "data_source": source})


@app.route("/api/lof/market", methods=["GET"])
def api_market():
    """获取实时行情"""
    code = request.args.get("code", "")
    if not code:
        return jsonify({"error": "请提供代码"}), 400

    result, source = DataSourceManager.get_stock_quote(code)
    result["data_source"] = source
    return jsonify(result)


@app.route("/api/lof/kline", methods=["GET"])
def api_kline():
    """获取K线数据"""
    code = request.args.get("code", "")
    count = int(request.args.get("count", 30))
    if not code:
        return jsonify({"error": "请提供代码"}), 400

    result, source = DataSourceManager.get_stock_kline(code, count)
    return jsonify({"data": result, "data_source": source})


@app.route("/api/lof/index", methods=["GET"])
def api_index():
    """获取指数行情"""
    index_code = request.args.get("code", "")
    if not index_code:
        return jsonify({"error": "请提供指数代码"}), 400

    result, source = DataSourceManager.get_index_quote(index_code)
    result["data_source"] = source
    return jsonify(result)


@app.route("/api/lof/tracking", methods=["GET"])
def api_tracking():
    """获取LOF追踪指数信息"""
    fund_code = request.args.get("code", "")
    if not fund_code:
        return jsonify({"error": "请提供基金代码"}), 400

    result = get_lof_tracking_index(fund_code)
    return jsonify(result)


@app.route("/api/lof/all", methods=["GET"])
def api_all():
    """获取所有数据"""
    fund_code = request.args.get("code", "")
    custom_index_code = request.args.get("custom_index_code", "")

    if not fund_code:
        return jsonify({"error": "请提供基金代码"}), 400

    try:
        # 获取追踪指数信息
        tracking_info = get_lof_tracking_index(fund_code)

        # 优先使用用户自定义的指数代码
        index_code_to_use = (
            custom_index_code if custom_index_code else tracking_info.get("index_code")
        )
        is_custom_index = bool(custom_index_code)

        # 获取净值数据
        nav_history, nav_source = DataSourceManager.get_fund_nav_history(fund_code, 30)
        nav_data = nav_history[0] if nav_history else {}

        # 获取二级市场行情
        market_data, market_source = DataSourceManager.get_stock_quote(fund_code)

        # 如果净值数据没有名称，从行情获取
        if nav_data and market_data:
            nav_data["name"] = market_data.get("name", "")

        # 获取K线数据
        kline_data, kline_source = DataSourceManager.get_stock_kline(fund_code, 30)

        # 获取指数历史K线数据（如果有指数代码）
        index_kline_data = []
        index_kline_source = "none"
        if index_code_to_use:
            index_kline_data, index_kline_source = DataSourceManager.get_index_kline(
                index_code_to_use, 30
            )

        # 合并历史数据
        history = []
        for nav in nav_history:
            price = None
            index_change = None

            for k in kline_data:
                if k["date"] == nav["date"]:
                    price = k["close"]
                    break

            # 获取指数涨跌幅
            for ik in index_kline_data:
                if ik["date"] == nav["date"]:
                    index_change = ik.get("change_percent")
                    break

            premium = None
            if price and nav["nav"]:
                premium = round((price - nav["nav"]) / nav["nav"] * 100, 2)

            history.append(
                {
                    "date": nav["date"],
                    "nav": nav["nav"],
                    "accumulated_nav": nav["accumulated_nav"],
                    "price": price,
                    "premium": premium,
                    "index_change": index_change,  # 指数涨跌幅
                }
            )

        # 获取指数行情
        index_data = {}
        index_source = "none"
        if index_code_to_use:
            index_data, index_source = DataSourceManager.get_index_quote(
                index_code_to_use
            )
            # 如果是自定义指数，更新tracking信息
            if is_custom_index:
                tracking_info["index_code"] = custom_index_code
                tracking_info["index_name"] = index_data.get("name", "自定义指数")
                tracking_info["is_custom"] = True

        return jsonify(
            {
                "nav": nav_data,
                "market": market_data,
                "history": history,
                "tracking": tracking_info,
                "index": index_data,
                "index_history": index_kline_data,  # 新增：指数历史数据
                "data_sources": {
                    "nav": nav_source,
                    "market": market_source,
                    "kline": kline_source,
                    "index": index_source,
                    "index_kline": index_kline_source,
                },
            }
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# 支持的指数列表
SUPPORTED_INDEXES = {
    "A股主要指数": [
        {"code": "000001", "name": "上证指数"},
        {"code": "399001", "name": "深证成指"},
        {"code": "000300", "name": "沪深300"},
        {"code": "000905", "name": "中证500"},
        {"code": "000852", "name": "中证1000"},
        {"code": "399006", "name": "创业板指"},
        {"code": "000688", "name": "科创50"},
        {"code": "399673", "name": "创业板50"},
    ],
    "A股行业指数": [
        {"code": "399997", "name": "中证白酒"},
        {"code": "000932", "name": "中证主要消费"},
        {"code": "399989", "name": "中证医疗"},
        {"code": "399932", "name": "中证医药"},
        {"code": "399808", "name": "中证新能源"},
        {"code": "399967", "name": "中证军工"},
        {"code": "399975", "name": "中证全指证券公司"},
        {"code": "399986", "name": "中证银行"},
        {"code": "000827", "name": "中证环保"},
        {"code": "000022", "name": "中证基建"},
        {"code": "000979", "name": "有色金属"},
        {"code": "399971", "name": "中证传媒"},
        {"code": "931151", "name": "中证光伏产业"},
        {"code": "399998", "name": "中证新能源车"},
        {"code": "931071", "name": "中证人工智能"},
        {"code": "931079", "name": "中证5G通信"},
        {"code": "930998", "name": "中证芯片"},
        {"code": "399994", "name": "信息安全"},
    ],
    "港股指数": [
        {"code": "HSI", "name": "恒生指数"},
        {"code": "HSTECH", "name": "恒生科技"},
        {"code": "HSCEI", "name": "恒生国企"},
    ],
    "美股指数": [
        {"code": "NDX", "name": "纳斯达克100"},
        {"code": "SPX", "name": "标普500"},
        {"code": "DJI", "name": "道琼斯工业平均"},
        {"code": "IXIC", "name": "纳斯达克综合"},
    ],
    "商品/期货": [
        {"code": "AU9999", "name": "黄金现货"},
        {"code": "CLU00", "name": "原油期货"},
    ],
}


@app.route("/api/lof/indexes", methods=["GET"])
def api_indexes():
    """获取支持的指数列表"""
    category = request.args.get("category", "")
    if category:
        return jsonify(
            {"category": category, "indexes": SUPPORTED_INDEXES.get(category, [])}
        )
    return jsonify(SUPPORTED_INDEXES)


@app.route("/health", methods=["GET"])
def health():
    """健康检查"""
    return jsonify({"status": "ok", "efinance_available": EFINANCE_AVAILABLE})


if __name__ == "__main__":
    print("LOF数据服务启动中...")
    print(f"端口: 3030")
    print(f"efinance可用: {EFINANCE_AVAILABLE}")
    app.run(host="0.0.0.0", port=3030, debug=False, threaded=True)
