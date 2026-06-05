type RuntimeEventChange = Record<string, unknown>;

type RuntimeEvent = RuntimeEventChange & {
  version: number;
  timestamp: string;
};

type RuntimeEventSubscriber = (event: RuntimeEvent) => void;

export function createRuntimeEventHub() {
  let version = 0;
  const subscribers = new Set<RuntimeEventSubscriber>();

  return {
    get version() {
      return version;
    },
    emit(change: RuntimeEventChange): RuntimeEvent {
      version += 1;
      const event = {
        version,
        timestamp: new Date().toISOString(),
        ...change,
      };
      for (const subscriber of subscribers) {
        subscriber(event);
      }
      return event;
    },
    subscribe(subscriber: RuntimeEventSubscriber): () => void {
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },
    close() {
      subscribers.clear();
    },
  };
}
