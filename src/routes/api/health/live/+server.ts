import { json } from '@sveltejs/kit';

export function GET() {
  return json({ status: 'live' }, { headers: { 'cache-control': 'no-store' } });
}
