/** Legacy links retain their preparation context and open the unified account page. */
import {Redirect, useLocalSearchParams} from 'expo-router';

export default function BankAccountScreen() {
  const params = useLocalSearchParams<{from?: string; articleId?: string; intent?: string}>();
  const forwarded: Record<string, string> = {};
  if (typeof params.from === 'string') forwarded.from = params.from;
  if (typeof params.articleId === 'string') forwarded.articleId = params.articleId;
  if (typeof params.intent === 'string') forwarded.intent = params.intent;
  return <Redirect href={{pathname: '/settings/stripe-onboarding', params: forwarded}} />;
}
