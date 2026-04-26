import { NextRequest, NextResponse } from 'next/server'

// 远程Python服务地址，设置为环境变量
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || ''

// 通过远程API获取数据
async function fetchFromRemoteAPI(action: string, code: string, customIndexCode?: string): Promise<any> {
  const params = new URLSearchParams({ code })
  if (customIndexCode) {
    params.set('custom_index_code', customIndexCode)
  }
  
  const url = `${PYTHON_SERVICE_URL}/api/lof/${action}?${params.toString()}`
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(60000),
  })
  
  if (!response.ok) {
    const error = await response.text()
    throw new Error(error || `HTTP ${response.status}`)
  }
  
  return response.json()
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const action = searchParams.get('action')
  const code = searchParams.get('code')
  const customIndexCode = searchParams.get('custom_index_code') || undefined
  
  if (!code) {
    return NextResponse.json({ error: '请提供LOF基金代码' }, { status: 400 })
  }
  
  if (!PYTHON_SERVICE_URL) {
    return NextResponse.json({ 
      error: 'Python服务未配置',
      detail: '请设置 PYTHON_SERVICE_URL 环境变量'
    }, { status: 500 })
  }
  
  try {
    const data = await fetchFromRemoteAPI(action || 'all', code, customIndexCode)
    return NextResponse.json(data)
  } catch (error) {
    console.error('API错误:', error)
    return NextResponse.json({ 
      error: '数据获取失败',
      detail: String(error)
    }, { status: 500 })
  }
}