import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// Python脚本路径
const VENV_PYTHON = '/home/z/my-project/mini-services/lof-service/venv/bin/python'

// 执行Python脚本获取数据
async function runPythonScript(action: string, code: string, customIndexCode?: string): Promise<any> {
  // 转义单引号，防止Python注入
  const safeCode = code.replace(/'/g, "\\'")
  const safeCustomIndexCode = customIndexCode ? customIndexCode.replace(/'/g, "\\'") : ''
  
  const pythonCode = `
import sys
sys.path.insert(0, '/home/z/my-project/mini-services/lof-service')
import json
from service import DataSourceManager, get_lof_tracking_index

action = '${action}'
code = '${safeCode}'
custom_index_code = '${safeCustomIndexCode}'

if action == 'nav':
    result, source = DataSourceManager.get_fund_nav_history(code, 1)
    data = result[0] if result else {}
    data['data_source'] = source
    print(json.dumps(data, ensure_ascii=False))
elif action == 'nav_history':
    result, source = DataSourceManager.get_fund_nav_history(code, 30)
    print(json.dumps({'data': result, 'data_source': source}, ensure_ascii=False))
elif action == 'market':
    result, source = DataSourceManager.get_stock_quote(code)
    result['data_source'] = source
    print(json.dumps(result, ensure_ascii=False))
elif action == 'kline':
    result, source = DataSourceManager.get_stock_kline(code, 30)
    print(json.dumps({'data': result, 'data_source': source}, ensure_ascii=False))
elif action == 'tracking':
    result = get_lof_tracking_index(code)
    print(json.dumps(result, ensure_ascii=False))
elif action == 'index':
    result, source = DataSourceManager.get_index_quote(code)
    result['data_source'] = source
    print(json.dumps(result, ensure_ascii=False))
elif action == 'index_kline':
    result, source = DataSourceManager.get_index_kline(code, 30)
    print(json.dumps({'data': result, 'data_source': source}, ensure_ascii=False))
elif action == 'all':
    tracking_info = get_lof_tracking_index(code)
    
    # 优先使用用户自定义的指数代码
    index_code_to_use = custom_index_code if custom_index_code else tracking_info.get('index_code')
    is_custom_index = bool(custom_index_code)
    
    nav_history, nav_source = DataSourceManager.get_fund_nav_history(code, 30)
    nav_data = nav_history[0] if nav_history else {}
    market_data, market_source = DataSourceManager.get_stock_quote(code)
    kline_data, kline_source = DataSourceManager.get_stock_kline(code, 30)
    
    # 获取指数历史K线数据
    index_kline_data = []
    index_kline_source = 'none'
    if index_code_to_use:
        index_kline_data, index_kline_source = DataSourceManager.get_index_kline(index_code_to_use, 30)
    
    if nav_data and market_data:
        nav_data['name'] = market_data.get('name', '')
    
    history = []
    for nav in nav_history:
        price = None
        index_change = None
        
        for k in kline_data:
            if k['date'] == nav['date']:
                price = k['close']
                break
        
        # 获取指数涨跌幅
        for ik in index_kline_data:
            if ik['date'] == nav['date']:
                index_change = ik.get('change_percent')
                break
        
        premium = None
        if price and nav['nav']:
            premium = round((price - nav['nav']) / nav['nav'] * 100, 2)
        history.append({
            'date': nav['date'],
            'nav': nav['nav'],
            'accumulated_nav': nav['accumulated_nav'],
            'price': price,
            'premium': premium,
            'index_change': index_change
        })
    
    # 获取指数行情
    index_data = {}
    index_source = 'none'
    if index_code_to_use:
        index_data, index_source = DataSourceManager.get_index_quote(index_code_to_use)
        # 更新tracking信息以反映实际使用的指数
        if is_custom_index:
            tracking_info['index_code'] = custom_index_code
            tracking_info['index_name'] = index_data.get('name', '自定义指数')
            tracking_info['is_custom'] = True
    
    print(json.dumps({
        'nav': nav_data,
        'market': market_data,
        'history': history,
        'tracking': tracking_info,
        'index': index_data,
        'index_history': index_kline_data,
        'data_sources': {
            'nav': nav_source,
            'market': market_source,
            'kline': kline_source,
            'index': index_source,
            'index_kline': index_kline_source
        }
    }, ensure_ascii=False))
`
  
  // Use base64 to avoid escaping issues
  const base64Code = Buffer.from(pythonCode).toString('base64')
  const command = `${VENV_PYTHON} -c "import base64; exec(base64.b64decode('${base64Code}').decode())"`
  
  try {
    const { stdout, stderr } = await execAsync(command, { 
      timeout: 90000,
      maxBuffer: 1024 * 1024 * 10
    })
    
    if (stderr && !stdout) {
      console.error('Python stderr:', stderr)
      throw new Error(stderr)
    }
    
    return JSON.parse(stdout.trim())
  } catch (error) {
    console.error('Python execution error:', error)
    throw error
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const action = searchParams.get('action')
  const code = searchParams.get('code')
  const customIndexCode = searchParams.get('custom_index_code') || undefined
  
  if (!code) {
    return NextResponse.json({ error: '请提供LOF基金代码' }, { status: 400 })
  }
  
  try {
    switch (action) {
      case 'nav': {
        const data = await runPythonScript('nav', code)
        return NextResponse.json(data)
      }
      
      case 'market': {
        const data = await runPythonScript('market', code)
        return NextResponse.json(data)
      }
      
      case 'nav_history': {
        const data = await runPythonScript('nav_history', code)
        return NextResponse.json(data)
      }
      
      case 'kline': {
        const data = await runPythonScript('kline', code)
        return NextResponse.json(data)
      }
      
      case 'tracking': {
        const data = await runPythonScript('tracking', code)
        return NextResponse.json(data)
      }
      
      case 'index': {
        const indexCode = searchParams.get('index_code') || code
        const data = await runPythonScript('index', indexCode)
        return NextResponse.json(data)
      }
      
      case 'index_kline': {
        const indexCode = searchParams.get('index_code') || code
        const data = await runPythonScript('index_kline', indexCode)
        return NextResponse.json(data)
      }
      
      case 'all': {
        const data = await runPythonScript('all', code, customIndexCode)
        return NextResponse.json(data)
      }
      
      default:
        return NextResponse.json({ error: '未知的操作类型' }, { status: 400 })
    }
  } catch (error) {
    console.error('API错误:', error)
    return NextResponse.json({ 
      error: '数据获取失败',
      detail: String(error)
    }, { status: 500 })
  }
}
