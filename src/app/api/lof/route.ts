import { NextRequest, NextResponse } from 'next/server'

// LOF追踪指数映射
const LOF_INDEX_MAP: Record<string, { index_code: string; index_name: string; coefficient: number }> = {
  '161725': { index_code: '399997', index_name: '中证白酒', coefficient: 0.95 },
  '161118': { index_code: '000932', index_name: '中证主要消费', coefficient: 0.95 },
  '501018': { index_code: 'CLU00', index_name: '原油期货', coefficient: 0.95 },
  '161116': { index_code: 'AU9999', index_name: '黄金现货', coefficient: 0.99 },
  '161831': { index_code: 'HSI', index_name: '恒生指数', coefficient: 0.95 },
  '160922': { index_code: 'HSI', index_name: '恒生指数', coefficient: 0.95 },
  '513060': { index_code: 'HSTECH', index_name: '恒生科技', coefficient: 0.95 },
  '161130': { index_code: 'NDX', index_name: '纳斯达克100', coefficient: 0.95 },
  '513100': { index_code: 'NDX', index_name: '纳斯达克100', coefficient: 0.95 },
  '161125': { index_code: 'SPX', index_name: '标普500', coefficient: 0.95 },
  '513500': { index_code: 'SPX', index_name: '标普500', coefficient: 0.95 },
  '161035': { index_code: '399989', index_name: '中证医疗', coefficient: 0.95 },
  '161028': { index_code: '399808', index_name: '中证新能源', coefficient: 0.95 },
  '161024': { index_code: '399967', index_name: '中证军工', coefficient: 0.95 },
  '161720': { index_code: '399975', index_name: '中证全指证券公司', coefficient: 0.95 },
  '161723': { index_code: '399986', index_name: '中证银行', coefficient: 0.95 },
  '161038': { index_code: '000827', index_name: '中证环保', coefficient: 0.95 },
  '161726': { index_code: '000022', index_name: '中证基建', coefficient: 0.95 },
  '161811': { index_code: '000300', index_name: '沪深300', coefficient: 0.95 },
  '161717': { index_code: '000905', index_name: '中证500', coefficient: 0.95 },
  '161913': { index_code: '399006', index_name: '创业板指', coefficient: 0.95 },
  '501082': { index_code: '000688', index_name: '科创50', coefficient: 0.95 },
  '164906': { index_code: 'H11136', index_name: '中国互联网50', coefficient: 0.95 },
  '164701': { index_code: 'AU9999', index_name: '黄金现货', coefficient: 0.99 },
  '160719': { index_code: 'AU9999', index_name: '黄金现货', coefficient: 0.99 },
}

// 指数代码到市场代码的映射
const INDEX_MARKET_MAP: Record<string, string> = {
  'HSI': '100', 'HSCEI': '100', 'HSTECH': '100', 'HSMEI': '100', 'HSCCI': '100', 'HSHKI': '100',
  'NDX': '100', 'SPX': '100', 'DJI': '100', 'IXIC': '100', 'RUT': '100', 'VIX': '100',
}

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': '*/*',
  'Referer': 'https://fund.eastmoney.com/',
}

async function fetchURL(url: string) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) })
  if (!res.ok) return null
  return res.text()
}

// 获取基金净值历史
async function getFundNavHistory(fundCode: string, count: number = 30) {
  const url = `https://fund.eastmoney.com/f10/F10DataApi.aspx?type=lsjz&code=${fundCode}&page=1&sdate=&edate=&per=${count}`
  const html = await fetchURL(url)
  if (!html) return []
  
  const result = []
  const pattern = /<td>(\d{4}-\d{2}-\d{2})</td>\s*<td[^>]*>([\d.]+)</td>\s*<td[^>]*>([\d.]+)</td>\s*<td[^>]*>([+-]?[\d.]+)?%?/g
  let match
  while ((match = pattern.exec(html)) !== null) {
    result.push({
      date: match[1],
      nav: parseFloat(match[2]) || null,
      accumulated_nav: parseFloat(match[3]) || null,
      daily_growth: match[4] ? parseFloat(match[4]) : null
    })
  }
  return result
}

// 获取LOF实时行情
async function getStockQuote(code: string) {
  const market = code.startsWith('50') || code.startsWith('6') || code.startsWith('9') ? '1' : '0'
  const secid = `${market}.${code}`
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f57,f58,f43,f169,f170,f46,f44,f51,f168,f47,f48,f60,f45,f52,f50,f49&ut=fa5fd1943c7b386f172d6893dbfba10b`
  const text = await fetchURL(url)
  if (!text) return {}
  
  const data = JSON.parse(text)
  if (!data.data) return {}
  
  const d = data.data
  const isLof = code.startsWith('16') || code.startsWith('50')
  const divisor = isLof ? 1000 : 100
  
  return {
    code: d.f57 || code,
    name: d.f58 || '',
    price: (d.f43 || 0) / divisor,
    change_percent: (d.f170 || 0) / 100,
    change: (d.f169 || 0) / divisor,
    open: (d.f46 || 0) / divisor,
    high: (d.f44 || 0) / divisor,
    low: (d.f51 || 0) / divisor,
    volume: d.f47 || 0,
    amount: d.f48 || 0,
    prev_close: (d.f60 || 0) / divisor,
  }
}

// 获取K线
async function getStockKline(code: string, count: number = 30) {
  const market = code.startsWith('50') || code.startsWith('6') || code.startsWith('9') ? '1' : '0'
  const secid = `${market}.${code}`
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&end=20500101&lmt=${count}`
  const text = await fetchURL(url)
  if (!text) return []
  
  const data = JSON.parse(text)
  if (!data.data?.klines) return []
  
  return data.data.klines.map((k: string) => {
    const p = k.split(',')
    return {
      date: p[0],
      open: parseFloat(p[1]),
      close: parseFloat(p[2]),
      high: parseFloat(p[3]),
      low: parseFloat(p[4]),
      volume: parseFloat(p[5]),
      amount: parseFloat(p[6]),
    }
  }).reverse()
}

// 获取指数市场列表 - 按优先级尝试不同市场
function getIndexMarkets(indexCode: string): string[] {
  // 已知港股/美股指数
  if (indexCode in INDEX_MARKET_MAP) {
    return [INDEX_MARKET_MAP[indexCode], '100']
  }
  
  // 纯数字A股指数：优先深市，再沪市
  if (/^\d{6}$/.test(indexCode)) {
    if (indexCode.startsWith('399') || indexCode.startsWith('0')) {
      return ['0', '1']
    } else if (indexCode.startsWith('6')) {
      return ['1', '0']
    } else {
      return ['0', '1']
    }
  }
  
  // 港股指数
  if (indexCode.startsWith('H') && indexCode.length <= 6) {
    return ['100', '0', '1']
  }
  
  // 其他默认港股/美股市场
  return ['100', '0', '1']
}

// 获取指数实时行情 - 带市场试换
async function getIndexQuote(indexCode: string) {
  // 优先尝试的市场顺序
  const markets = getIndexMarkets(indexCode)
  
  for (const market of markets) {
    const secid = `${market}.${indexCode}`
    const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f57,f58,f43,f169,f170,f60&ut=fa5fd1943c7b386f172d6893dbfba10b`
    const text = await fetchURL(url)
    if (!text) continue
    
    const data = JSON.parse(text)
    if (!data.data) continue
    
    const d = data.data
    const priceDivisor = market === '100' ? 1 : 100
    
    return {
      code: d.f57 || indexCode,
      name: d.f58 || '',
      price: (d.f43 || 0) / priceDivisor,
      change_percent: (d.f170 || 0) / 100,
      change: (d.f169 || 0) / priceDivisor,
      prev_close: (d.f60 || 0) / priceDivisor,
    }
  }
  
  return {}
}

// 获取指数K线 - 带市场试换
async function getIndexKline(indexCode: string, count: number = 30) {
  // 优先尝试的市场顺序
  const markets = getIndexMarkets(indexCode)
  
  for (const market of markets) {
    const secid = `${market}.${indexCode}`
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&end=20500101&lmt=${count + 1}`
    const text = await fetchURL(url)
    if (!text) continue
    
    const data = JSON.parse(text)
    if (!data.data?.klines) continue
    
    const klines = data.data.klines
    const result = []
    
    for (let i = 0; i < klines.length; i++) {
      const parts = klines[i].split(',')
      const date = parts[0]
      const close = parseFloat(parts[2])
      
      let changePercent = null
      if (i > 0) {
        const prevParts = klines[i - 1].split(',')
        const prevClose = parseFloat(prevParts[2])
        if (close && prevClose && prevClose > 0) {
          changePercent = parseFloat(((close - prevClose) / prevClose * 100).toFixed(2))
        }
      }
      
      result.push({
        date,
        open: parseFloat(parts[1]),
        close,
        high: parseFloat(parts[3]),
        low: parseFloat(parts[4]),
        change_percent: changePercent,
      })
    }
    
    return result
  }
  
  return []
}

// 获取追踪指数
function getTrackingIndex(code: string) {
  return LOF_INDEX_MAP[code] || { index_code: null, index_name: '未知', coefficient: 0.95 }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  const customIndexCode = searchParams.get('custom_index_code') || undefined
  
  if (!code) {
    return NextResponse.json({ error: '请提供LOF基金代码' }, { status: 400 })
  }
  
  try {
    // 获取追踪指数信息
    let trackingInfo = getTrackingIndex(code)
    const isCustomIndex = !!customIndexCode
    
    // 优先使用用户自定义指数
    const indexCodeToUse = customIndexCode || trackingInfo.index_code
    
    // 获取所有数据
    const [navHistory, marketData, klineData, indexData, indexKlineData] = await Promise.all([
      getFundNavHistory(code, 30),
      getStockQuote(code),
      getStockKline(code, 30),
      indexCodeToUse ? getIndexQuote(indexCodeToUse) : Promise.resolve({}),
      indexCodeToUse ? getIndexKline(indexCodeToUse, 30) : Promise.resolve([]),
    ])
    
    const navData = navHistory[0] || {}
    if (navData && marketData.name) {
      navData.name = marketData.name
    }
    
    // 构建历史数据
    const history = []
    for (const nav of navHistory) {
      let price = null
      let indexChange = null
      
      // 匹配价格
      for (const k of klineData) {
        if (k.date === nav.date) {
          price = k.close
          break
        }
      }
      
      // 匹配指数涨跌幅 - 添加日期兼容处理
      for (const ik of indexKlineData) {
        // 直接匹配
        if (ik.date === nav.date) {
          indexChange = ik.change_percent
          break
        }
        // 尝试标准化匹配 (处理2024-01-15 vs 2024/01/15 或其他格式差异)
        const navDateNorm = nav.date?.replace(/\//g, '-')
        const ikDateNorm = ik.date?.replace(/\//g, '-')
        if (navDateNorm && ikDateNorm && (navDateNorm === ikDateNorm || navDateNorm.substring(0, 10) === ikDateNorm.substring(0, 10))) {
          indexChange = ik.change_percent
          break
        }
      }
      
      const premium = price && nav.nav ? parseFloat(((price - nav.nav) / nav.nav * 100).toFixed(2)) : null
      
      history.push({
        date: nav.date,
        nav: nav.nav,
        accumulated_nav: nav.accumulated_nav,
        price,
        premium,
        index_change: indexChange,
      })
    }
    
    // 更新tracking信息
    if (isCustomIndex) {
      trackingInfo = {
        index_code: customIndexCode,
        index_name: indexData.name || '自定义指数',
        coefficient: 0.95,
        is_custom: true,
      }
    }
    
    return NextResponse.json({
      nav: navData,
      market: marketData,
      history,
      tracking: trackingInfo,
      index: indexData,
      index_history: indexKlineData,
      data_sources: {
        nav: 'http',
        market: 'http',
        kline: 'http',
        index: 'http',
        index_kline: 'http',
      },
    })
  } catch (error) {
    console.error('API错误:', error)
    return NextResponse.json({
      error: '数据获取失败',
      detail: String(error)
    }, { status: 500 })
  }
}