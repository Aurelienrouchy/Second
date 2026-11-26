export const queryKeys = {
  eligibility: {
    owner: (uid: string) => ['eligibility', 'owner', uid] as const,
    reviews: (uid: string) => ['eligibility', 'owner', uid, 'reviews'] as const,
    review: (uid: string, id: string) => ['eligibility', 'owner', uid, 'review', id] as const,
    admin: (uid: string) => ['eligibility', 'admin', uid] as const,
    adminPermission: (uid: string) => ['eligibility', 'admin', uid, 'permission'] as const,
    adminQueue: (uid: string, status: string | null) => ['eligibility', 'admin', uid, 'queue', status] as const,
    adminReview: (uid: string, id: string) => ['eligibility', 'admin', uid, 'review', id] as const,
  },
  articles: {
    all: ['articles'] as const,
    detail: (id: string) => ['articles', id] as const,
    userList: (userId: string) => ['articles', 'user', userId] as const,
    search: (params: {
      query: string;
      categoryPath: string[];
      filters: Record<string, unknown>;
      excludeUserId?: string;
      sellerId?: string;
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
    transaction: (chatId: string, userId: string) => ['chat', 'transaction', userId, chatId] as const,
    transactionHistory: (chatId: string, userId: string) => ['chat', 'transaction', userId, chatId, 'history'] as const,
    selectedTransaction: (chatId: string, userId: string, transactionId: string) => ['chat', 'transaction', userId, chatId, 'selected', transactionId] as const,
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
    items: (id: string) => ['swap-parties', id, 'items'] as const,
  },
  payments: {
    all: ['payments'] as const,
    transaction: (id: string, userId: string) => ['payments', userId, id] as const,
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
  },
  wallet: {
    all: ['wallet'] as const,
    info: () => ['wallet', 'info'] as const,
    withdrawals: (userId: string) => ['wallet', 'withdrawals', userId] as const,
  },
  stripe: {
    all: ['stripe'] as const,
    accountStatus: (userId?: string) =>
      ['stripe', 'accountStatus', userId ?? null] as const,
  },
  automatedDecisions: {
    all: ['automated-decisions'] as const,
    log: (transactionId: string) =>
      ['automated-decisions', 'log', transactionId] as const,
  },
} as const;
