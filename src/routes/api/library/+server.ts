import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { apiError } from '$lib/server/http';
import { runtime } from '$lib/server/runtime';

const uploadSchema = z.object({
  name: z.string().max(100).default(''),
  category: z.string().max(40).default(''),
  role: z.enum(['ambience', 'soundboard'])
});

export async function GET() {
  await runtime.initialize();
  return json({ assets: runtime.library.list() }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST({ request }: { request: Request }) {
  try {
    await runtime.initialize();
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new Error('Choose an MP3 file to upload.');

    const fields = uploadSchema.parse({
      name: String(form.get('name') ?? ''),
      category: String(form.get('category') ?? ''),
      role: String(form.get('role') ?? '')
    });
    const asset = await runtime.library.add({
      bytes: new Uint8Array(await file.arrayBuffer()),
      originalFilename: file.name,
      name: fields.name,
      category: fields.category,
      role: fields.role
    });
    return json({ asset }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
