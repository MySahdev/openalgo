import {
  ArrowLeft,
  CheckCircle,
  Download,
  Loader2,
  Play,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { backtestApi } from '@/api/backtest'
import { historifyApi } from '@/api/historify'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PythonEditor } from '@/components/ui/python-editor'
import { SymbolSearch } from '@/components/ui/symbol-search'
import type { BacktestProgress } from '@/types/backtest'
import { EXCHANGE_OPTIONS, INTERVAL_OPTIONS } from '@/types/backtest'
import { showToast } from '@/utils/toast'

const DEFAULT_STRATEGY = `from openalgo import api

# Initialize client
client = api(api_key="your_api_key", host="http://127.0.0.1:5000")

# Strategy parameters
symbol = "NIFTY"
exchange = "NSE"

while True:
    # Get historical data
    df = client.history(symbol=symbol, exchange=exchange, interval="D")

    if len(df) < 15:
        import time
        time.sleep(5)
        continue

    # Calculate 9-period and 15-period EMAs
    df["ema_9"] = df["close"].ewm(span=9).mean()
    df["ema_15"] = df["close"].ewm(span=15).mean()

    # EMA crossover logic — trades both long and short
    if df["ema_9"].iloc[-1] > df["ema_15"].iloc[-1] and df["ema_9"].iloc[-2] <= df["ema_15"].iloc[-2]:
        # Bullish crossover — go long
        client.placesmartorder(
            strategy="ema_crossover",
            symbol=symbol,
            action="BUY",
            exchange=exchange,
            price_type="MARKET",
            product="MIS",
            quantity=1,
            position_size=1,
        )

    elif df["ema_9"].iloc[-1] < df["ema_15"].iloc[-1] and df["ema_9"].iloc[-2] >= df["ema_15"].iloc[-2]:
        # Bearish crossover — go short
        client.placesmartorder(
            strategy="ema_crossover",
            symbol=symbol,
            action="SELL",
            exchange=exchange,
            price_type="MARKET",
            product="MIS",
            quantity=1,
            position_size=-1,
        )

    import time
    time.sleep(5)
`

export default function NewBacktest() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const eventSourceRef = useRef<EventSource | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [strategyCode, setStrategyCode] = useState(DEFAULT_STRATEGY)
  const [symbols, setSymbols] = useState('NIFTY')
  const [exchange, setExchange] = useState('NSE')
  const [interval, setInterval] = useState('D')
  const [startDate, setStartDate] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  })
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0]
  })
  const [initialCapital, setInitialCapital] = useState('100000')
  const [slippagePct, setSlippagePct] = useState('0.05')
  const [commissionPerOrder, setCommissionPerOrder] = useState('20')
  const [commissionPct] = useState('0')

  // Running state
  const [isRunning, setIsRunning] = useState(false)
  const [backtestId, setBacktestId] = useState<string | null>(null)
  const [progress, setProgress] = useState<BacktestProgress | null>(null)
  const [dataCheck, setDataCheck] = useState<{
    checked: boolean
    available: boolean
    message: string
    unavailableSymbols: string[]
  }>({ checked: false, available: false, message: '', unavailableSymbols: [] })
  const [isFetching, setIsFetching] = useState(false)
  const [fetchProgress, setFetchProgress] = useState('')

  // Load strategy code from URL params (e.g., from python strategy page)
  // Or load full config from a previous backtest (rerun)
  useEffect(() => {
    const code = searchParams.get('code')
    const stratName = searchParams.get('name')
    const rerunId = searchParams.get('rerun')

    if (rerunId) {
      // Load config from previous backtest for rerun
      backtestApi.getConfig(rerunId).then((data) => {
        setName(`${data.name} (rerun)`)
        setStrategyCode(data.strategy_code)
        setSymbols(data.config.symbols.join(', '))
        setExchange(data.config.exchange || 'NSE')
        setInterval(data.config.interval)
        setStartDate(data.config.start_date)
        setEndDate(data.config.end_date)
        setInitialCapital(String(data.config.initial_capital))
        setSlippagePct(String(data.config.slippage_pct))
        setCommissionPerOrder(String(data.config.commission_per_order))
      }).catch(() => {
        showToast.error('Failed to load backtest config for rerun')
      })
    } else {
      if (code) setStrategyCode(decodeURIComponent(code))
      if (stratName) setName(decodeURIComponent(stratName))
    }
  }, [searchParams])

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [])

  const checkDataAvailability = useCallback(async () => {
    const symbolList = symbols.split(',').map((s) => s.trim()).filter(Boolean)
    if (symbolList.length === 0) {
      setDataCheck({ checked: true, available: false, message: 'No symbols specified', unavailableSymbols: [] })
      return
    }

    try {
      const result = await backtestApi.checkData({
        symbols: symbolList,
        exchange,
        interval,
        start_date: startDate,
        end_date: endDate,
      })

      const unavailable = symbolList.filter(
        (s) => !result.details[s]?.has_data
      )

      if (result.available) {
        setDataCheck({
          checked: true,
          available: true,
          message: `Data available for all ${symbolList.length} symbol(s)`,
          unavailableSymbols: [],
        })
      } else {
        setDataCheck({
          checked: true,
          available: false,
          message: `No data for: ${unavailable.join(', ')}`,
          unavailableSymbols: unavailable,
        })
      }
    } catch {
      setDataCheck({
        checked: true,
        available: false,
        message: 'Failed to check data availability',
        unavailableSymbols: [],
      })
    }
  }, [symbols, exchange, interval, startDate, endDate])

  // Map user-selected interval to Historify storage interval (only 1m and D are stored)
  const getDownloadInterval = (iv: string) => {
    if (iv === 'D') return 'D'
    return '1m' // 5m, 15m, 30m, 1h all need 1m data
  }

  const handleFetchData = useCallback(async () => {
    const missingSymbols = dataCheck.unavailableSymbols
    if (missingSymbols.length === 0) return

    setIsFetching(true)
    setFetchProgress('Starting download...')

    try {
      const downloadInterval = getDownloadInterval(interval)
      const result = await historifyApi.createJob({
        symbols: missingSymbols.map((s) => ({ symbol: s, exchange })),
        interval: downloadInterval,
        start_date: startDate,
        end_date: endDate,
      })

      if (result.status !== 'success') {
        throw new Error(result.message || 'Failed to create download job')
      }

      const jobId = result.job_id
      setFetchProgress(`Downloading ${result.total_symbols} symbol(s)...`)

      // Poll job status
      const poll = async () => {
        const maxAttempts = 300 // 5 minutes at 1s intervals
        for (let i = 0; i < maxAttempts; i++) {
          await new Promise((r) => setTimeout(r, 2000))
          try {
            const status = await historifyApi.getJobStatus(jobId)
            setFetchProgress(
              `Downloaded ${status.completed_symbols}/${status.total_symbols} symbol(s)${
                status.failed_symbols > 0 ? ` (${status.failed_symbols} failed)` : ''
              }`
            )

            if (
              status.status === 'completed' ||
              status.status === 'completed_with_errors' ||
              status.status === 'failed' ||
              status.status === 'cancelled'
            ) {
              return status
            }
          } catch {
            // Ignore poll errors, keep trying
          }
        }
        return null
      }

      const finalStatus = await poll()

      if (finalStatus?.status === 'completed' && finalStatus.failed_symbols === 0) {
        showToast.success('Data downloaded successfully')
      } else if (finalStatus?.status === 'completed_with_errors') {
        showToast.error(`${finalStatus.failed_symbols} symbol(s) failed to download`)
      } else if (finalStatus?.status === 'failed') {
        showToast.error('Download failed')
      } else if (finalStatus?.status === 'cancelled') {
        showToast.error('Download was cancelled')
      } else if (!finalStatus) {
        showToast.error('Download timed out')
      }

      // Auto-recheck data availability
      setIsFetching(false)
      setFetchProgress('')
      await checkDataAvailability()
    } catch (err: unknown) {
      setIsFetching(false)
      setFetchProgress('')
      const message = err instanceof Error ? err.message : 'Failed to fetch data'
      showToast.error(message)
    }
  }, [dataCheck.unavailableSymbols, exchange, interval, startDate, endDate, checkDataAvailability])

  const handleRun = async () => {
    if (!strategyCode.trim()) {
      showToast.error('Strategy code cannot be empty')
      return
    }

    const symbolList = symbols.split(',').map((s) => s.trim()).filter(Boolean)
    if (symbolList.length === 0) {
      showToast.error('At least one symbol is required')
      return
    }

    setIsRunning(true)
    setProgress(null)

    try {
      const result = await backtestApi.run({
        name: name || `Backtest ${new Date().toLocaleDateString()}`,
        strategy_code: strategyCode,
        symbols: symbolList,
        exchange,
        start_date: startDate,
        end_date: endDate,
        interval,
        initial_capital: Number(initialCapital),
        slippage_pct: Number(slippagePct),
        commission_per_order: Number(commissionPerOrder),
        commission_pct: Number(commissionPct),
      })

      setBacktestId(result.backtest_id)

      // Connect to SSE for progress
      const es = backtestApi.createProgressStream(result.backtest_id)
      eventSourceRef.current = es

      es.onmessage = (event) => {
        try {
          const data: BacktestProgress = JSON.parse(event.data)
          if (data.heartbeat) return

          setProgress(data)

          if (data.status === 'completed') {
            es.close()
            eventSourceRef.current = null
            showToast.success('Backtest completed')
            setTimeout(() => {
              navigate(`/backtest/${result.backtest_id}`)
            }, 500)
          } else if (data.status === 'failed') {
            es.close()
            eventSourceRef.current = null
            setIsRunning(false)
            showToast.error(data.message || 'Backtest failed')
          } else if (data.status === 'cancelled') {
            es.close()
            eventSourceRef.current = null
            setIsRunning(false)
            showToast.error('Backtest cancelled')
          }
        } catch {
          // Ignore parse errors
        }
      }

      es.onerror = () => {
        es.close()
        eventSourceRef.current = null
        setIsRunning(false)
      }
    } catch {
      setIsRunning(false)
      showToast.error('Failed to start backtest')
    }
  }

  const handleCancel = async () => {
    if (backtestId) {
      try {
        await backtestApi.cancel(backtestId)
        showToast.success('Cancellation requested')
      } catch {
        showToast.error('Failed to cancel')
      }
    }
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/backtest')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">New Backtest</h1>
          <p className="text-muted-foreground text-sm">
            Configure and run a backtest on historical data
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Strategy Code Editor */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Strategy Code</CardTitle>
              <CardDescription>
                Paste your live trading strategy code. It will run as-is with the
                openalgo API mocked for backtesting.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PythonEditor
                value={strategyCode}
                onChange={setStrategyCode}
                height="500px"
              />
            </CardContent>
          </Card>

          {/* Progress Card */}
          {isRunning && progress && (
            <Card>
              <CardContent className="py-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>{progress.message}</span>
                    <span className="font-mono">{progress.progress}%</span>
                  </div>
                  <Progress value={progress.progress} className="h-2" />
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: Configuration */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="name">Backtest Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My EMA Strategy"
                />
              </div>

              <div>
                <Label>Symbols</Label>
                <SymbolSearch
                  value={symbols}
                  onChange={setSymbols}
                  exchange={exchange}
                  placeholder="Search symbols to add..."
                  disabled={isRunning}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Exchange</Label>
                  <Select value={exchange} onValueChange={setExchange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXCHANGE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Interval</Label>
                  <Select value={interval} onValueChange={setInterval}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INTERVAL_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="start_date">Start Date</Label>
                  <Input
                    id="start_date"
                    type="date"
                    value={startDate}
                    max={endDate}
                    onChange={(e) => {
                      const val = e.target.value
                      setStartDate(val)
                      if (val > endDate) setEndDate(val)
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="end_date">End Date</Label>
                  <Input
                    id="end_date"
                    type="date"
                    value={endDate}
                    min={startDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="capital">Initial Capital</Label>
                <Input
                  id="capital"
                  type="number"
                  value={initialCapital}
                  onChange={(e) => setInitialCapital(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="slippage">Slippage %</Label>
                  <Input
                    id="slippage"
                    type="number"
                    step="0.01"
                    value={slippagePct}
                    onChange={(e) => setSlippagePct(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="commission">Commission/Order</Label>
                  <Input
                    id="commission"
                    type="number"
                    step="1"
                    value={commissionPerOrder}
                    onChange={(e) => setCommissionPerOrder(e.target.value)}
                  />
                </div>
              </div>

              {/* Data Availability Check */}
              <div className="pt-2 border-t">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={checkDataAvailability}
                  disabled={isRunning || isFetching}
                >
                  Check Data Availability
                </Button>
                {dataCheck.checked && (
                  <div className="mt-2 space-y-2">
                    <div className="flex items-start gap-2 text-sm">
                      {dataCheck.available ? (
                        <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                      )}
                      <span className={dataCheck.available ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                        {dataCheck.message}
                      </span>
                    </div>
                    {/* Fetch Missing Data button */}
                    {!dataCheck.available && dataCheck.unavailableSymbols.length > 0 && (
                      <div className="space-y-2">
                        <Button
                          variant="secondary"
                          className="w-full"
                          onClick={handleFetchData}
                          disabled={isFetching || isRunning}
                        >
                          {isFetching ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4 mr-2" />
                          )}
                          {isFetching ? 'Fetching...' : `Fetch Data for ${dataCheck.unavailableSymbols.join(', ')}`}
                        </Button>
                        {isFetching && fetchProgress && (
                          <p className="text-xs text-muted-foreground text-center">
                            {fetchProgress}
                          </p>
                        )}
                        {!isFetching && interval !== 'D' && interval !== '1m' && (
                          <p className="text-xs text-muted-foreground">
                            Will download 1-minute data (aggregated to {interval} during backtest)
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Run / Cancel */}
              <div className="pt-2">
                {isRunning ? (
                  <Button
                    variant="destructive"
                    className="w-full"
                    onClick={handleCancel}
                  >
                    Cancel Backtest
                  </Button>
                ) : (
                  <Button className="w-full" onClick={handleRun}>
                    <Play className="h-4 w-4 mr-2" />
                    Run Backtest
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
