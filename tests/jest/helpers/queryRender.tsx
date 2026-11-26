import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, renderHook, type RenderOptions, type RenderHookOptions } from '@testing-library/react-native';

const clients = new Set<QueryClient>();
function wrapper(Inner?: RenderOptions['wrapper']) {
  const client = new QueryClient({ defaultOptions: {
    queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity },
  } });
  clients.add(client);
  return function QueryFixture({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{Inner ? <Inner>{children}</Inner> : children}</QueryClientProvider>;
  };
}
afterEach(() => { cleanup(); for (const client of clients) client.clear(); clients.clear(); });
export function renderWithQuery<T>(element: React.ReactElement<T>, options?: RenderOptions) {
  return render(element, { ...options, wrapper: wrapper(options?.wrapper) });
}
export function renderHookWithQuery<Result, Props>(hook: (props: Props) => Result, options?: RenderHookOptions<Props>) {
  return renderHook(hook, { ...options, wrapper: wrapper(options?.wrapper) });
}
