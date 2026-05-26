export const queryKeys = {
  articles: {
    all: ['articles'] as const,
    detail: (id: string) => ['articles', id] as const,
    userList: (userId: string) => ['articles', 'user', userId] as const,
    search: (params: {
      query: string;
      categoryPath: string[];
      filters: Record<string, unknown>;
      excludeUserId?: string;
    }) => ['articles', 'search', params] as const,
  },
  notifications: {
    all: ['notifications'] as const,
    list: (userId: string) => ['notifications', userId] as const,
  },
  orders: {
    all: ['orders'] as const,
    list: (userId: string) => ['orders', userId] as const,
  },
  chat: {
    all: ['chat'] as const,
    article: (articleId: string) => ['chat', 'article', articleId] as const,
    transaction: (chatId: string) => ['chat', 'transaction', chatId] as const,
  },
  shops: {
    all: ['shops'] as const,
    detail: (id: string) => ['shops', id] as const,
  },
  users: {
    all: ['users'] as const,
    profile: (id: string) => ['users', id] as const,
    articles: (userId: string) => ['users', 'articles', userId] as const,
  },
  swaps: {
    all: ['swaps'] as const,
    userList: (userId: string) => ['swaps', userId] as const,
    detail: (id: string) => ['swaps', id] as const,
  },
  swapParties: {
    all: ['swap-parties'] as const,
    list: () => ['swap-parties', 'list'] as const,
    detail: (id: string) => ['swap-parties', id] as const,
  },
  payments: {
    all: ['payments'] as const,
    transaction: (id: string) => ['payments', id] as const,
  },
  reviews: {
    all: ['reviews'] as const,
    user: (userId: string) => ['reviews', 'user', userId] as const,
    transaction: (transactionId: string) => ['reviews', 'transaction', transactionId] as const,
  },
  sellers: {
    all: ['sellers'] as const,
    liked: (userId: string) => ['sellers', 'liked', userId] as const,
    likedIds: (userId: string) => ['sellers', 'likedIds', userId] as const,
    balance: (userId: string) => ['sellers', 'balance', userId] as const,
  },
} as const;
