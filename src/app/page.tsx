'use client'

import { useState, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { 
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { 
  RefreshCw, TrendingUp, TrendingDown, Loader2, Calculator, Info, 
  AlertCircle, ArrowRight, Database
} from 'lucide-react'

// 支持的指数列表
const SUPPORTED_INDEXES = {
  'A股主要指数': [
    { code: '000001', name: '上证指数' },
    { code: '399001', name: '深证成指' },
    { code: '000300', name: '沪深300' },
    { code: '000905', name: '中证500' },
    { code: '000852', name: '中证1000' },
    { code: '399006', name: '创业板指' },
    { code: '000688', name: '科创50' },
    { code: '399673', name: '创业板50' },
  ],
  'A股行业指数': [
    { code: '399997', name: '中证白酒' },
    { code: '000932', name: '中证主要消费' },
    { code: '399989', name: '中证医疗' },
    { code: '399932', name: '中证医药' },
    { code: '399808', name: '中证新能源' },
    { code: '399967', name: '中证军工' },
    { code: '399975', name: '中证全指证券公司' },
    { code: '399986', name: '中证银行' },
    { code: '000827', name: '中证环保' },
    { code: '000022', name: '中证基建' },
    { code: '000979', name: '有色金属' },
    { code: '399971', name: '中证传媒' },
    { code: '931151', name: '中证光伏产业' },
    { code: '399998', name: '中证新能源车' },
    { code: '931071', name: '中证人工智能' },
    { code: '931079', name: '中证5G通信' },
    { code: '930998', name: '中证芯片' },
    { code: '399994', name: '信息安全' },
  ],
  '港股指数': [
    { code: 'HSI', name: '恒生指数' },
    { code: 'HSTECH', name: '恒生科技' },
    { code: 'HSCEI', name: '恒生国企' },
  ],
  '美股指数': [
    { code: 'NDX', name: '纳斯达克100' },
    { code: 'SPX', name: '标普500' },
    { code: 'DJI', name: '道琼斯工业平均' },
    { code: 'IXIC', name: '纳斯达克综合' },
  ],
  '商品/期货': [
    { code: 'AU9999', name: '黄金现货' },
    { code: 'CLU00', name: '原油期货' },
  ],
}

// 类型定义
interface NavData {
  date: string
  nav: number
  accumulated_nav: number
  daily_growth?: number
  name?: string
}

interface MarketData {
  code: string
  name: string
  price: number
  change: number
  change_percent: number
  open: number
  high: number
  low: number
  volume: number
  amount: number
  prev_close?: number
}

interface IndexData {
  code: string
  name: string
  price: number
  change: number
  change_percent: number
  prev_close?: number
}

interface TrackingInfo {
  index_code: string | null
  index_name: string
  coefficient: number
  is_custom?: boolean  // 是否为用户自定义指数
}

interface HistoryItem {
  date: string
  nav: number
  accumulated_nav: number
  price: number | null
  premium: number | null
  index_change?: number | null  // 指数涨跌幅
}

interface IndexKlineItem {
  date: string
  open: number | null
  close: number | null
  high: number | null
  low: number | null
  change_percent: number | null
}

interface DataSources {
  nav: string
  market: string
  kline: string
  index: string
  index_kline?: string
}

interface AllData {
  nav: NavData | null
  market: MarketData | null
  history: HistoryItem[]
  tracking: TrackingInfo | null
  index: IndexData | null
  index_history?: IndexKlineItem[]
  data_sources?: DataSources
  error?: string
  detail?: string
}

export default function Home() {
  // 输入参数
  const [lofCode, setLofCode] = useState('')
  const [customIndexCode, setCustomIndexCode] = useState('')  // 用户自定义指数代码
  const [indexChange, setIndexChange] = useState('')
  const [adjustCoefficient, setAdjustCoefficient] = useState('0.95')
  const [useAutoIndex, setUseAutoIndex] = useState(true)
  
  // 数据状态
  const [data, setData] = useState<AllData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [serviceStatus, setServiceStatus] = useState<'unknown' | 'online' | 'offline'>('unknown')
  
  // 检查服务状态
  const checkServiceStatus = async () => {
    try {
      const response = await fetch('/api/lof?action=nav&code=161725', { 
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      })
      setServiceStatus(response.ok ? 'online' : 'offline')
    } catch {
      setServiceStatus('offline')
    }
  }
  
  useEffect(() => {
    checkServiceStatus()
  }, [])
  
  // 计算实时折溢价
  const calculateRealtimePremium = useCallback(() => {
    if (!data?.nav || !data?.market) return null
    
    const yesterdayNav = data.nav.nav
    const todayPrice = data.market.price
    
    // 使用自动获取的指数涨跌幅或手动输入
    let indexChangeValue: number
    if (useAutoIndex && data.index?.change_percent !== undefined) {
      indexChangeValue = data.index.change_percent / 100
    } else {
      indexChangeValue = parseFloat(indexChange) / 100
    }
    
    const coefficient = parseFloat(adjustCoefficient) || data.tracking?.coefficient || 0.95
    
    // 估算净值 = 昨日净值 * (1 + 追踪指数涨跌幅 * 校对系数)
    const estimatedNav = yesterdayNav * (1 + indexChangeValue * coefficient)
    
    // 折溢价率 = (二级市场价格 - 估算净值) / 估算净值 * 100
    const premiumPercent = ((todayPrice - estimatedNav) / estimatedNav) * 100
    
    return {
      yesterdayNav,
      todayPrice,
      indexChangeValue,
      coefficient,
      estimatedNav,
      premiumPercent,
      indexName: data.index?.name || data.tracking?.index_name || '未知指数',
      indexCode: data.index?.code || data.tracking?.index_code || ''
    }
  }, [data, indexChange, adjustCoefficient, useAutoIndex])
  
  // 获取数据
  const fetchData = async () => {
    if (!lofCode.trim()) {
      setError('请输入LOF基金代码')
      return
    }
    
    setLoading(true)
    setError('')
    
    try {
      // 构建请求URL，如果有自定义指数代码则传递给后端
      let url = `/api/lof?action=all&code=${lofCode.trim()}`
      if (customIndexCode.trim()) {
        url += `&custom_index_code=${encodeURIComponent(customIndexCode.trim())}`
      }
      const response = await fetch(url)
      const result = await response.json()
      
      if (result.error) {
        setError(result.error + (result.detail ? `: ${result.detail}` : ''))
        setData(null)
      } else {
        setData(result)
        // 自动设置校对系数
        if (result.tracking?.coefficient) {
          setAdjustCoefficient(String(result.tracking.coefficient))
        }
      }
    } catch (err) {
      setError('数据获取失败，请检查网络连接或基金代码是否正确')
      setData(null)
    } finally {
      setLoading(false)
    }
  }
  
  // 格式化数字
  const formatNumber = (num: number | null | undefined, decimals: number = 4) => {
    if (num === null || num === undefined || isNaN(num)) return '-'
    return num.toFixed(decimals)
  }
  
  // 格式化金额
  const formatAmount = (num: number | null | undefined) => {
    if (num === null || num === undefined || isNaN(num)) return '-'
    if (num >= 100000000) return (num / 100000000).toFixed(2) + '亿'
    if (num >= 10000) return (num / 10000).toFixed(2) + '万'
    return num.toFixed(2)
  }
  
  // 计算结果
  const calculation = calculateRealtimePremium()
  
  // 计算历史估算差值
  const getHistoryWithEstimation = () => {
    if (!data?.history || data.history.length < 2) return []
    
    const coefficient = parseFloat(adjustCoefficient) || data.tracking?.coefficient || 0.95
    
    return data.history.map((item, index) => {
      if (index === 0) {
        return {
          ...item,
          estimatedNav: null,
          estimatedPremium: null,
          actualPremium: item.premium,
          estimationDiff: null
        }
      }
      
      const prevItem = data.history[index - 1]
      
      // 优先使用指数涨跌幅来估算
      let estimatedNav: number | null = null
      if (item.index_change !== null && item.index_change !== undefined && prevItem.nav) {
        // 使用指数涨跌幅估算
        estimatedNav = prevItem.nav * (1 + item.index_change / 100 * coefficient)
      } else if (item.price && prevItem.price) {
        // 备用：使用价格变化率估算
        const priceChangeRate = (item.price - prevItem.price) / prevItem.price
        estimatedNav = prevItem.nav * (1 + priceChangeRate * coefficient)
      }
      
      const estimatedPremium = item.price && estimatedNav ? ((item.price - estimatedNav) / estimatedNav * 100) : null
      const actualPremium = item.premium
      const estimationDiff = estimatedPremium !== null && actualPremium !== null ? estimatedPremium - actualPremium : null
      
      return {
        ...item,
        estimatedNav,
        estimatedPremium,
        actualPremium,
        estimationDiff
      }
    })
  }
  
  const historyWithEstimation = getHistoryWithEstimation()
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        {/* 标题 */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-100 mb-2">
            LOF基金折溢价计算器
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            输入LOF代码，自动获取追踪指数涨跌幅，计算实时折溢价
          </p>
          <div className="flex items-center justify-center gap-2 mt-2">
            <Badge variant={serviceStatus === 'online' ? 'default' : serviceStatus === 'offline' ? 'destructive' : 'secondary'}
                   className={serviceStatus === 'online' ? 'bg-green-500 hover:bg-green-600' : ''}>
              <Database className="h-3 w-3 mr-1" />
              {serviceStatus === 'online' ? '服务正常' : serviceStatus === 'offline' ? '服务离线' : '检测中...'}
            </Badge>
          </div>
        </div>
        
        {/* 服务状态提示 */}
        {serviceStatus === 'offline' && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Python服务未启动</AlertTitle>
            <AlertDescription>
              请在终端执行以下命令启动服务：
              <code className="block mt-2 p-2 bg-slate-100 dark:bg-slate-800 rounded text-sm">
                cd /home/z/my-project/mini-services/lof-service && source venv/bin/activate && python service.py
              </code>
            </AlertDescription>
          </Alert>
        )}
        
        {/* 输入区域 */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              参数设置
            </CardTitle>
            <CardDescription>
              输入LOF基金代码，系统将自动识别追踪指数并获取实时涨跌幅
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="space-y-2">
                <Label htmlFor="lofCode">LOF基金代码</Label>
                <Input
                  id="lofCode"
                  placeholder="如: 161725"
                  value={lofCode}
                  onChange={(e) => setLofCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && fetchData()}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="customIndexCode">
                  指数选择
                  <span className="text-blue-600 text-xs ml-1">(可选)</span>
                </Label>
                <Select value={customIndexCode} onValueChange={setCustomIndexCode}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择或输入指数代码" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(SUPPORTED_INDEXES).map(([category, indexes]) => (
                      <SelectGroup key={category}>
                        <SelectLabel>{category}</SelectLabel>
                        {indexes.map((idx) => (
                          <SelectItem key={idx.code} value={idx.code}>
                            {idx.name} ({idx.code})
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500">
                  也可手动输入: 如 399997/HSI/NDX
                </p>
                <Input
                  id="customIndexCodeManual"
                  placeholder="或手动输入指数代码"
                  value={customIndexCode}
                  onChange={(e) => setCustomIndexCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && fetchData()}
                  className="mt-1"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="indexChange">
                  指数涨跌幅(%)
                  {data?.index && (
                    <span className="text-green-600 text-xs ml-1">(已获取)</span>
                  )}
                </Label>
                <Input
                  id="indexChange"
                  placeholder={data?.index ? `${data.index.change_percent.toFixed(2)}%` : "自动获取或手动输入"}
                  value={indexChange}
                  onChange={(e) => {
                    setIndexChange(e.target.value)
                    setUseAutoIndex(false)
                  }}
                  disabled={!!data?.index && useAutoIndex}
                />
                {data?.index && useAutoIndex && (
                  <p className="text-xs text-slate-500">
                    {data.index.name} {data.index.change_percent >= 0 ? '+' : ''}{data.index.change_percent.toFixed(2)}%
                  </p>
                )}
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="adjustCoefficient">校对系数</Label>
                <Input
                  id="adjustCoefficient"
                  placeholder="默认: 0.95"
                  value={adjustCoefficient}
                  onChange={(e) => setAdjustCoefficient(e.target.value)}
                />
              </div>
              
              <div className="flex items-end">
                <Button 
                  onClick={fetchData} 
                  disabled={loading}
                  className="w-full"
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      获取中...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      刷新数据
                    </>
                  )}
                </Button>
              </div>
            </div>
            
            {/* 指数代码提示 */}
            <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 mt-0.5 text-blue-600 dark:text-blue-400" />
                <div className="text-sm text-blue-700 dark:text-blue-300">
                  <strong>指数代码说明：</strong>
                  支持A股指数（如 399997 白酒、000300 沪深300）、港股指数（HSI 恒生、HSTECH 恒生科技）、美股指数（NDX 纳斯达克100、SPX 标普500）。
                  填写后系统将获取该指数的实时涨跌数据用于计算折溢价。留空则使用默认映射关系。
                </div>
              </div>
            </div>
            
            {error && (
              <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
                {error}
              </div>
            )}
          </CardContent>
        </Card>
        
        {data && (
          <>
            {/* 追踪指数信息 */}
            {data.tracking && (
              <Card className="mb-6 border-blue-200 dark:border-blue-800">
                <CardContent className="pt-4">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                      <ArrowRight className="h-4 w-4 text-blue-600" />
                      <span className="font-medium">
                        {data.tracking.is_custom ? '自定义指数:' : '追踪指数:'}
                      </span>
                      <Badge variant="outline">
                        {data.tracking.index_name}
                        {data.tracking.is_custom && (
                          <span className="ml-1 text-blue-600">(自定义)</span>
                        )}
                      </Badge>
                    </div>
                    {data.tracking.index_code && (
                      <div className="flex items-center gap-2">
                        <span className="text-slate-600 dark:text-slate-400">指数代码:</span>
                        <code className="text-sm">{data.tracking.index_code}</code>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-slate-600 dark:text-slate-400">默认系数:</span>
                      <code className="text-sm">{data.tracking.coefficient}</code>
                    </div>
                  </div>
                  
                  {/* 数据来源显示 */}
                  {data.data_sources && (
                    <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        <span className="text-slate-500">数据来源:</span>
                        <Badge variant="outline" className={data.data_sources.nav === 'efinance' ? 'border-green-500 text-green-600' : 'border-amber-500 text-amber-600'}>
                          净值: {data.data_sources.nav === 'efinance' ? 'efinance' : 'HTTP备用'}
                        </Badge>
                        <Badge variant="outline" className={data.data_sources.market === 'efinance' ? 'border-green-500 text-green-600' : 'border-amber-500 text-amber-600'}>
                          行情: {data.data_sources.market === 'efinance' ? 'efinance' : 'HTTP备用'}
                        </Badge>
                        <Badge variant="outline" className={data.data_sources.index === 'efinance' ? 'border-green-500 text-green-600' : 'border-amber-500 text-amber-600'}>
                          指数: {data.data_sources.index === 'efinance' ? 'efinance' : 'HTTP备用'}
                        </Badge>
                        {data.data_sources.index_kline && data.data_sources.index_kline !== 'none' && (
                          <Badge variant="outline" className="border-blue-500 text-blue-600">
                            指数历史: HTTP
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
            
            {/* 实时数据展示 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* 基金信息 */}
              <Card>
                <CardHeader>
                  <CardTitle>基金净值信息</CardTitle>
                </CardHeader>
                <CardContent>
                  {data.nav ? (
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-600 dark:text-slate-400">基金名称</span>
                        <span className="font-medium">{data.nav.name || '-'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-600 dark:text-slate-400">净值日期</span>
                        <span className="font-medium">{data.nav.date}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-600 dark:text-slate-400">昨日净值</span>
                        <span className="font-medium text-lg">{formatNumber(data.nav.nav)}</span>
                      </div>
                      {data.nav.daily_growth !== undefined && data.nav.daily_growth !== null && (
                        <div className="flex justify-between items-center">
                          <span className="text-slate-600 dark:text-slate-400">日增长率</span>
                          <span className={`font-medium ${data.nav.daily_growth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {data.nav.daily_growth >= 0 ? '+' : ''}{formatNumber(data.nav.daily_growth, 2)}%
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-slate-500 text-center py-4">暂无净值数据</div>
                  )}
                </CardContent>
              </Card>
              
              {/* 二级市场行情 */}
              <Card>
                <CardHeader>
                  <CardTitle>二级市场行情</CardTitle>
                </CardHeader>
                <CardContent>
                  {data.market && data.market.price > 0 ? (
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-600 dark:text-slate-400">当前价格</span>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-lg">{formatNumber(data.market.price, 3)}</span>
                          <Badge 
                            variant={data.market.change_percent >= 0 ? 'default' : 'destructive'} 
                            className={data.market.change_percent >= 0 ? 'bg-green-500 hover:bg-green-600' : ''}
                          >
                            {data.market.change_percent >= 0 ? (
                              <TrendingUp className="h-3 w-3 mr-1" />
                            ) : (
                              <TrendingDown className="h-3 w-3 mr-1" />
                            )}
                            {data.market.change_percent >= 0 ? '+' : ''}{formatNumber(data.market.change_percent, 2)}%
                          </Badge>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="flex justify-between">
                          <span className="text-slate-600 dark:text-slate-400">开盘</span>
                          <span>{formatNumber(data.market.open, 3)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600 dark:text-slate-400">最高</span>
                          <span className="text-red-600">{formatNumber(data.market.high, 3)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600 dark:text-slate-400">最低</span>
                          <span className="text-green-600">{formatNumber(data.market.low, 3)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600 dark:text-slate-400">成交额</span>
                          <span>{formatAmount(data.market.amount)}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-slate-500 text-center py-4">
                      暂无行情数据（可能非交易时间或代码错误）
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
            
            {/* 指数行情卡片 */}
            {data.index && data.index.price > 0 && (
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    追踪指数行情
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap items-center gap-6">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-600 dark:text-slate-400">指数名称:</span>
                      <span className="font-medium">{data.index.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-600 dark:text-slate-400">当前点位:</span>
                      <span className="font-medium text-lg">{formatNumber(data.index.price, 2)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-600 dark:text-slate-400">今日涨跌:</span>
                      <Badge 
                        variant={data.index.change_percent >= 0 ? 'default' : 'destructive'}
                        className={data.index.change_percent >= 0 ? 'bg-green-500 hover:bg-green-600' : ''}
                      >
                        {data.index.change_percent >= 0 ? '+' : ''}{formatNumber(data.index.change_percent, 2)}%
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            
            {/* 折溢价计算结果 */}
            {calculation && data.market && data.market.price > 0 && (
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Info className="h-5 w-5" />
                    实时折溢价估算
                  </CardTitle>
                  <CardDescription>
                    基于昨日净值、追踪指数涨跌幅和校对系数计算
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <div className="space-y-2">
                      <div className="text-sm text-slate-600 dark:text-slate-400">计算公式</div>
                      <div className="text-xs bg-slate-100 dark:bg-slate-800 p-2 rounded font-mono">
                        估算净值 = 昨日净值 × (1 + 指数涨跌幅 × 校对系数)
                      </div>
                    </div>
                    
                    <div className="space-y-3">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-600 dark:text-slate-400">昨日净值</span>
                        <span className="font-medium">{formatNumber(calculation.yesterdayNav)}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-600 dark:text-slate-400">{calculation.indexName}涨跌幅</span>
                        <span className={`font-medium ${calculation.indexChangeValue >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {calculation.indexChangeValue >= 0 ? '+' : ''}{(calculation.indexChangeValue * 100).toFixed(2)}%
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-600 dark:text-slate-400">校对系数</span>
                        <span className="font-medium">{calculation.coefficient}</span>
                      </div>
                    </div>
                    
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-600 dark:text-slate-400">估算净值</span>
                        <span className="font-medium text-blue-600 text-lg">{formatNumber(calculation.estimatedNav)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-600 dark:text-slate-400">二级市场价格</span>
                        <span className="font-medium text-lg">{formatNumber(calculation.todayPrice, 3)}</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-slate-100 dark:bg-slate-800 rounded-lg">
                        <span className="font-medium">实时折溢价率</span>
                        <span className={`font-bold text-xl ${calculation.premiumPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {calculation.premiumPercent >= 0 ? '+' : ''}{formatNumber(calculation.premiumPercent, 2)}%
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  {/* 折溢价说明 */}
                  <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                    <div className="flex items-start gap-2">
                      <Info className="h-4 w-4 mt-0.5 text-blue-600 dark:text-blue-400" />
                      <div className="text-sm text-blue-700 dark:text-blue-300">
                        <strong>折溢价说明：</strong>
                        正值表示溢价（二级市场价格高于估算净值），负值表示折价（二级市场价格低于估算净值）。
                        溢价时可考虑申购后卖出套利，折价时可考虑买入后赎回套利。
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            
            {/* 历史数据 */}
            <Card>
              <CardHeader>
                <CardTitle>历史净值与价格</CardTitle>
                <CardDescription>
                  显示最近30个交易日的净值、价格及折溢价数据
                  {data?.tracking?.index_name && (
                    <span className="ml-2 text-blue-600 dark:text-blue-400">
                      （指数: {data.tracking.index_name}）
                    </span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="history">
                  <TabsList className="mb-4">
                    <TabsTrigger value="history">历史数据</TabsTrigger>
                    <TabsTrigger value="analysis">折溢价分析</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="history">
                    <div className="rounded-lg border overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-50 dark:bg-slate-800">
                            <TableHead className="font-medium">日期</TableHead>
                            <TableHead className="font-medium text-right">单位净值</TableHead>
                            <TableHead className="font-medium text-right">累计净值</TableHead>
                            <TableHead className="font-medium text-right">收盘价</TableHead>
                            <TableHead className="font-medium text-right">指数涨跌</TableHead>
                            <TableHead className="font-medium text-right">折溢价率</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.history.length > 0 ? (
                            data.history.map((item, index) => (
                              <TableRow key={index}>
                                <TableCell className="font-medium">{item.date}</TableCell>
                                <TableCell className="text-right">{formatNumber(item.nav)}</TableCell>
                                <TableCell className="text-right">{formatNumber(item.accumulated_nav)}</TableCell>
                                <TableCell className="text-right">
                                  {item.price ? formatNumber(item.price, 3) : '-'}
                                </TableCell>
                                <TableCell className="text-right">
                                  {item.index_change !== null && item.index_change !== undefined ? (
                                    <span className={item.index_change >= 0 ? 'text-green-600' : 'text-red-600'}>
                                      {item.index_change >= 0 ? '+' : ''}{formatNumber(item.index_change, 2)}%
                                    </span>
                                  ) : '-'}
                                </TableCell>
                                <TableCell className="text-right">
                                  {item.premium !== null ? (
                                    <span className={item.premium >= 0 ? 'text-green-600' : 'text-red-600'}>
                                      {item.premium >= 0 ? '+' : ''}{formatNumber(item.premium, 2)}%
                                    </span>
                                  ) : '-'}
                                </TableCell>
                              </TableRow>
                            ))
                          ) : (
                            <TableRow>
                              <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                                暂无历史数据
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="analysis">
                    <div className="rounded-lg border overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-50 dark:bg-slate-800">
                            <TableHead className="font-medium">日期</TableHead>
                            <TableHead className="font-medium text-right">指数涨跌</TableHead>
                            <TableHead className="font-medium text-right">估算净值</TableHead>
                            <TableHead className="font-medium text-right">估算折溢价率</TableHead>
                            <TableHead className="font-medium text-right">实际折溢价率</TableHead>
                            <TableHead className="font-medium text-right">估算偏差</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {historyWithEstimation.length > 0 ? (
                            historyWithEstimation.map((item, index) => (
                              <TableRow key={index}>
                                <TableCell className="font-medium">{item.date}</TableCell>
                                <TableCell className="text-right">
                                  {item.index_change !== null && item.index_change !== undefined ? (
                                    <span className={item.index_change >= 0 ? 'text-green-600' : 'text-red-600'}>
                                      {item.index_change >= 0 ? '+' : ''}{formatNumber(item.index_change, 2)}%
                                    </span>
                                  ) : '-'}
                                </TableCell>
                                <TableCell className="text-right">
                                  {item.estimatedNav ? formatNumber(item.estimatedNav) : '-'}
                                </TableCell>
                                <TableCell className="text-right">
                                  {item.estimatedPremium !== null ? (
                                    <span className={item.estimatedPremium >= 0 ? 'text-blue-600' : 'text-orange-600'}>
                                      {item.estimatedPremium >= 0 ? '+' : ''}{formatNumber(item.estimatedPremium, 2)}%
                                    </span>
                                  ) : '-'}
                                </TableCell>
                                <TableCell className="text-right">
                                  {item.actualPremium !== null ? (
                                    <span className={item.actualPremium >= 0 ? 'text-green-600' : 'text-red-600'}>
                                      {item.actualPremium >= 0 ? '+' : ''}{formatNumber(item.actualPremium, 2)}%
                                    </span>
                                  ) : '-'}
                                </TableCell>
                                <TableCell className="text-right">
                                  {item.estimationDiff !== null ? (
                                    <span className={item.estimationDiff >= 0 ? 'text-green-600' : 'text-red-600'}>
                                      {item.estimationDiff >= 0 ? '+' : ''}{formatNumber(item.estimationDiff, 2)}%
                                    </span>
                                  ) : '-'}
                                </TableCell>
                              </TableRow>
                            ))
                          ) : (
                            <TableRow>
                              <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                                暂无分析数据
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                    
                    <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                      <div className="flex items-start gap-2">
                        <Info className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400" />
                        <div className="text-sm text-amber-700 dark:text-amber-300">
                          <strong>估算偏差说明：</strong>
                          估算净值 = 前一日净值 × (1 + 指数涨跌幅 × 校对系数)。估算偏差 = 估算折溢价率 - 实际折溢价率。
                          正值表示估算净值高于实际净值，负值表示估算净值低于实际净值。
                          偏差主要来源于基金跟踪误差、管理费、仓位调整等因素。
                        </div>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </>
        )}
        
        {/* 使用说明 */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>使用说明</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
              <div className="space-y-2">
                <h4 className="font-medium">LOF基金代码</h4>
                <p className="text-slate-600 dark:text-slate-400">
                  输入6位LOF基金代码，如161725（招商白酒）、501018（南方原油）等。支持深市16开头和沪市50开头的LOF。
                </p>
              </div>
              <div className="space-y-2">
                <h4 className="font-medium">指数选择</h4>
                <p className="text-slate-600 dark:text-slate-400">
                  可从下拉列表选择指数，或手动输入指数代码。支持A股指数（白酒、医疗等）、港股指数（恒生、恒生科技）、美股指数（纳指100、标普500）。
                </p>
              </div>
              <div className="space-y-2">
                <h4 className="font-medium">追踪指数涨跌幅</h4>
                <p className="text-slate-600 dark:text-slate-400">
                  系统自动识别追踪指数并获取实时涨跌幅，也可手动输入。选择自定义指数后将覆盖默认映射。
                </p>
              </div>
              <div className="space-y-2">
                <h4 className="font-medium">校对系数</h4>
                <p className="text-slate-600 dark:text-slate-400">
                  业绩比较基准系数，通常为0.9-0.95，表示基金实际收益与指数收益的比例关系
                </p>
              </div>
            </div>
            
            <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <div className="flex items-start gap-2">
                <Database className="h-4 w-4 mt-0.5 text-green-600 dark:text-green-400" />
                <div className="text-sm text-green-700 dark:text-green-300">
                  <strong>数据来源：</strong>主数据源使用 efinance 库，备用数据源通过 HTTP 请求东方财富/天天基金网 API。当主数据源获取失败时自动切换到备用数据源，确保数据获取稳定性。
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        
        {/* 页脚 */}
        <footer className="mt-8 text-center text-sm text-slate-500 dark:text-slate-400">
          <p>数据来源：efinance库（主） + HTTP备用（东方财富/天天基金网） | 仅供参考，不构成投资建议</p>
        </footer>
      </div>
    </div>
  )
}
