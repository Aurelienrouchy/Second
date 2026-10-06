import { act, fireEvent, render } from '@testing-library/react-native';
import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import type { Article } from '@/types';

const mockScrollToOffset = jest.fn();
const mockListMounted = jest.fn();
jest.mock('@shopify/flash-list', () => {
  const ReactRuntime = require('react');
  const { View: NativeView } = require('react-native');
  return {
    FlashList: ReactRuntime.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      ReactRuntime.useEffect(() => { mockListMounted(); }, []);
      ReactRuntime.useImperativeHandle(ref, () => ({ scrollToOffset: mockScrollToOffset }));
      const renderItem = props.renderItem as jest.Mock;
      return ReactRuntime.createElement(NativeView, { ...props },
        props.ListHeaderComponent,
        ...(props.data as Article[]).map((item) => ReactRuntime.createElement(ReactRuntime.Fragment, { key: item.id }, renderItem({ item }))),
        props.ListFooterComponent);
    }),
  };
});

import { ArticleGrid } from '../ArticleGrid';
import { ArticleGridItem } from '../ArticleGridItem';

const article = { id: 'one', title: 'Robe', price: 12, images: [{ url: 'https://example.com/photo.jpg' }] } as Article;

describe('profile content continuity', () => {
  it('keeps the list and header mounted and restores independent Articles/Avis scroll positions', () => {
    jest.useFakeTimers();
    const headerMounted = jest.fn();
    function Header() { useEffect(() => { headerMounted(); }, []); return <Text>Profil</Text>; }
    const screen = render(<ArticleGrid articles={[article]} onArticlePress={jest.fn()} contentKey="articles" ListHeaderComponent={<Header />} />);
    const list = () => screen.getByTestId('profile-content-list');
    fireEvent(list(), 'scrollBeginDrag');
    fireEvent.scroll(list(), { nativeEvent: { contentOffset: { y: 620 } } });
    fireEvent(list(), 'momentumScrollEnd');
    screen.rerender(<ArticleGrid articles={[]} onArticlePress={jest.fn()} contentKey="avis" showEmptyState={false} ListHeaderComponent={<Header />} ListFooterComponent={<View><Text>Avis</Text></View>} />);
    act(() => jest.advanceTimersByTime(32));
    expect(mockScrollToOffset).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0, animated: false }));
    fireEvent(list(), 'scrollBeginDrag');
    fireEvent.scroll(list(), { nativeEvent: { contentOffset: { y: 180 } } });
    fireEvent(list(), 'momentumScrollEnd');
    screen.rerender(<ArticleGrid articles={[article]} onArticlePress={jest.fn()} contentKey="articles" ListHeaderComponent={<Header />} />);
    act(() => jest.advanceTimersByTime(32));
    expect(mockScrollToOffset).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 620, animated: false }));
    expect(headerMounted).toHaveBeenCalledTimes(1);
    expect(mockListMounted).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});

describe('profile article photos', () => {
  it('normalizes legacy URLs, shows a fallback on load failure, and preserves the article link', () => {
    const onPress = jest.fn();
    const legacy = { ...article, images: ['https://firebasestorage.googleapis.com/v0/b/test/o/articles/item/photo.jpg?alt=media'] } as unknown as Article;
    const screen = render(<ArticleGridItem article={legacy} onPress={onPress} />);
    expect(screen.getByTestId('profile-article-image-one').props.source).toEqual({ uri: 'https://firebasestorage.googleapis.com/v0/b/test/o/articles%2Fitem%2Fphoto.jpg?alt=media' });
    fireEvent(screen.getByTestId('profile-article-image-one'), 'error', { error: 'missing' });
    expect(screen.getByLabelText('Photo indisponible')).toBeTruthy();
    fireEvent.press(screen.getByTestId('profile-article-one'));
    expect(onPress).toHaveBeenCalledWith('one');
  });
});
