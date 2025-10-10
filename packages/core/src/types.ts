export interface Task {
  status: 'open' | 'ready' | 'in_progress' | 'review' | 'completed';
  title: string;
  plan?: string;
  workingDir?: string;
  content: string;
  path: string;
}

export interface SabinConfig {
  projectPrefix: string;
  taskNumberPadding: number;
}