import React from 'react'

export type RepoFetchContextValue = {
  baseUrl: string
  resolve: (path: string) => string
  fetch: (input: RequestInfo | URL | string, init?: RequestInit) => Promise<Response>
  // Optional helpers for validated fetches (non-breaking addition)
  fetchJson?: (path: string, init?: RequestInit) => Promise<any>
}

const defaultValue: RepoFetchContextValue = {
  baseUrl: '/',
  resolve: (p: string) => p,
  fetch: (input: any, init?: RequestInit) => (window.fetch as any)(input, init),
}

export const RepoFetchContext = React.createContext<RepoFetchContextValue>(defaultValue)

export function useRepoFetch() {
  return React.useContext(RepoFetchContext)
}

export function RepoFetchProvider({ value, children }: { value: RepoFetchContextValue; children: React.ReactNode }) {
  return <RepoFetchContext.Provider value={value}>{children}</RepoFetchContext.Provider>
}
