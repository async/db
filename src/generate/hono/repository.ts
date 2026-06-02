import { generatedHeader } from './header.js';

export function renderRepositoryTypes(): string {
  return `${generatedHeader()}
export type CollectionRepository = {
  all(): Promise<Record<string, unknown>[]>;
  get(id: string): Promise<Record<string, unknown> | null>;
  create(record: Record<string, unknown>): Promise<Record<string, unknown>>;
  patch(id: string, patch: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  delete(id: string): Promise<boolean>;
};

export type DocumentRepository = {
  all(): Promise<Record<string, unknown>>;
  put(value: Record<string, unknown>): Promise<Record<string, unknown>>;
  patch(value: Record<string, unknown>): Promise<Record<string, unknown>>;
};

export type DbRepository = {
  resources: Record<string, any>;
  collection(name: string): CollectionRepository;
  document(name: string): DocumentRepository;
  close?(): void;
};
`;
}
