import { z } from 'zod'

const schema = z.object({
  DATABASE_URL:        z.string().min(1),
  DATABASE_AUTH_TOKEN: z.string().default(''),
  AUTH_SECRET:         z.string().min(32),
  ANTHROPIC_API_KEY:   z.string().startsWith('sk-ant-'),
  NEXTAUTH_URL:        z.string().url().default('http://localhost:3000'),
})

export const env = schema.parse(process.env)
