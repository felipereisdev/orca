import type { TaskProvider } from '../work-items/task-providers'

export type TaskStartImage = {
  origin: { kind: 'description' } | { kind: 'comment'; author: string; at: string }
  url: string
  path?: string
  failed?: true
}

export type TaskStartContext = {
  displayId: string
  title: string
  url: string
  provider: TaskProvider
  description: string
  comments: { author: string; at: string; body: string }[]
  images: TaskStartImage[]
}
