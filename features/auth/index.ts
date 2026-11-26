/**
 * Authentification — barrel de la feature.
 *
 * Les imports vers cette feature passent par `@/features/auth`,
 * jamais en deep import.
 */

export { default as AuthBottomSheet } from './components/AuthBottomSheet';
export { AuthToggle, AuthToggleProps } from './components/AuthToggle';
export { ConsentFields, ConsentFieldsProps } from './components/ConsentFields';
export { ForgotPasswordForm, ForgotPasswordFormProps } from './components/ForgotPasswordForm';
export { SignInForm, SignInFormProps } from './components/SignInForm';
export { SignUpForm, SignUpFormProps } from './components/SignUpForm';
export { SocialAuthButtons, SocialAuthButtonsProps } from './components/SocialAuthButtons';
export { styles } from './components/styles';
