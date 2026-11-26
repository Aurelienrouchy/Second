/**
 * Article feature — barrel exports.
 */

export { ArticleCTABar } from './components/ArticleCTABar';
export { ArticleDetails } from './components/ArticleDetails';
export { ArticleFloatingHeader, ArticleHero } from './components/ArticleHero';
export { ErrorState, LoadingState } from './components/LoadingState';
export { articleStyles, HERO_HEIGHT } from './styles';
export { buildTags, formatArticleDate, getDiscountPercent, spotIcon } from './utils';
export { useArticleActions } from './hooks/useArticleActions';
