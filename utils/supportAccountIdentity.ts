/** Firebase UIDs are native identifiers. Whitespace and Unicode form are significant. */
export const isDeclaredSupportAccountId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 &&
  !value.includes('/') && value !== '.' && value !== '..' && !/^__.*__$/.test(value);
export const declaredSupportAccountInput = (value: string, single = false): string[] => single ? value.length ? [value] : [] : value.split('\n').filter(item => item.length > 0);
export const isDeclaredSupportAccountList = (value: unknown, maximum = 5): value is string[] => Array.isArray(value) && value.length >= 1 && value.length <= maximum && value.every(isDeclaredSupportAccountId) && new Set(value).size === value.length;
