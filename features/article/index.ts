/**
 * Article feature — barrel exports.
 */

export { ArticleCTABar } from './components/ArticleCTABar';
export { ArticleDetails } from './components/ArticleDetails';
export { ArticleFloatingHeader, ArticleHero } from './components/ArticleHero';
export { ErrorState, LoadingState } from './components/LoadingState';
export { useArticleActions } from './hooks/useArticleActions';
export { articleStyles, HERO_HEIGHT } from './styles';
export { buildTags, formatArticleDate, getDiscountPercent, spotEmoji } from './utils';
