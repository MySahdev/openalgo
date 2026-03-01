import { webClient } from './client'

export interface HistorifyJobResponse {
  status: string
  message: string
  job_id: string
  total_symbols: number
  incremental: boolean
}

export interface HistorifyJobStatus {
  id: string
  job_type: string
  status: 'pending' | 'running' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled' | 'paused'
  total_symbols: number
  completed_symbols: number
  failed_symbols: number
  interval: string
  start_date: string
  end_date: string
  created_at: string | null
  started_at: string | null
  completed_at: string | null
  error_message: string | null
}

export const historifyApi = {
  /**
   * Create a download job to fetch historical data from broker
   */
  createJob: async (params: {
    symbols: { symbol: string; exchange: string }[]
    interval: string
    start_date: string
    end_date: string
  }): Promise<HistorifyJobResponse> => {
    const response = await webClient.post<HistorifyJobResponse>(
      '/historify/api/jobs',
      {
        job_type: 'custom',
        symbols: params.symbols,
        interval: params.interval,
        start_date: params.start_date,
        end_date: params.end_date,
        incremental: false,
      }
    )
    return response.data
  },

  /**
   * Get status of a download job
   * Response format: { status: "success", job: {...}, items: [...] }
   */
  getJobStatus: async (jobId: string): Promise<HistorifyJobStatus> => {
    const response = await webClient.get<{ status: string; job: HistorifyJobStatus }>(
      `/historify/api/jobs/${jobId}`
    )
    return response.data.job
  },
}
