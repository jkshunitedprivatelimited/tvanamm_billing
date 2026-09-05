import { redirect } from 'next/navigation';
import { requireOperator } from '@/server/auth';

export default async function Home() {
  await requireOperator();
  redirect('/pos');
}
