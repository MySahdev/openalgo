import { X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

interface SearchResult {
  symbol: string
  name: string
  exchange: string
  token: string
}

interface SymbolSearchProps {
  /** Comma-separated symbols string */
  value: string
  /** Called with updated comma-separated symbols string */
  onChange: (value: string) => void
  /** Exchange to filter search results */
  exchange?: string
  /** Placeholder text */
  placeholder?: string
  /** Disabled state */
  disabled?: boolean
}

export function SymbolSearch({
  value,
  onChange,
  exchange,
  placeholder = 'Search symbols...',
  disabled = false,
}: SymbolSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [showResults, setShowResults] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedSymbols = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.length >= 2) {
        performSearch(query)
      } else {
        setResults([])
        setShowResults(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query, exchange])

  // Click outside handler
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setShowResults(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const performSearch = async (q: string) => {
    try {
      const params = new URLSearchParams({ q })
      if (exchange) params.append('exchange', exchange)
      const response = await fetch(`/search/api/search?${params}`, {
        credentials: 'include',
      })
      const data = await response.json()
      setResults((data.results || []).slice(0, 10))
      setShowResults(true)
    } catch {
      setResults([])
    }
  }

  const addSymbol = useCallback(
    (symbol: string) => {
      if (!selectedSymbols.includes(symbol)) {
        const updated = [...selectedSymbols, symbol]
        onChange(updated.join(', '))
      }
      setQuery('')
      setResults([])
      setShowResults(false)
    },
    [selectedSymbols, onChange]
  )

  const removeSymbol = useCallback(
    (symbol: string) => {
      const updated = selectedSymbols.filter((s) => s !== symbol)
      onChange(updated.join(', '))
    },
    [selectedSymbols, onChange]
  )

  return (
    <div ref={containerRef} className="space-y-2">
      {/* Selected symbols as badges */}
      {selectedSymbols.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedSymbols.map((sym) => (
            <Badge
              key={sym}
              variant="secondary"
              className="text-xs px-2 py-0.5 gap-1"
            >
              {sym}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeSymbol(sym)}
                  className="ml-0.5 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <Input
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value.toUpperCase())}
          onFocus={() => {
            if (results.length > 0) setShowResults(true)
          }}
          disabled={disabled}
          className="h-9"
        />

        {/* Dropdown results */}
        {showResults && results.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-lg z-50 max-h-60 overflow-auto">
            {results.map((result) => {
              const alreadyAdded = selectedSymbols.includes(result.symbol)
              return (
                <div
                  key={`${result.symbol}-${result.exchange}`}
                  className={`px-3 py-2 cursor-pointer ${
                    alreadyAdded
                      ? 'opacity-50'
                      : 'hover:bg-muted'
                  }`}
                  onClick={() => {
                    if (!alreadyAdded) addSymbol(result.symbol)
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{result.symbol}</span>
                    <span className="text-xs text-muted-foreground">
                      {result.exchange}
                    </span>
                  </div>
                  {result.name && (
                    <div className="text-xs text-muted-foreground truncate">
                      {result.name}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
