import { HandoffTask } from '../types';
import { apiFetch } from './client';

export async function getTasks(): Promise<HandoffTask[]> {
  return apiFetch<HandoffTask[]>('/tasks');
}

export async function addTask(task: HandoffTask): Promise<HandoffTask> {
  return apiFetch<HandoffTask>('/tasks', {
    method: 'POST',
    body: JSON.stringify(task),
  });
}

export async function updateTask(id: string, patch: Partial<HandoffTask>): Promise<HandoffTask> {
  return apiFetch<HandoffTask>(`/tasks/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export async function deleteTask(id: string): Promise<void> {
  await apiFetch(`/tasks/${id}`, { method: 'DELETE' });
}
