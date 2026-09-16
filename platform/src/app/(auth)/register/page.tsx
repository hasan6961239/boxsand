import type { Metadata } from 'next';
import { RegisterForm } from './register-form';

export const metadata: Metadata = { title: 'إنشاء حساب' };

export default function RegisterPage() {
  return <RegisterForm />;
}
