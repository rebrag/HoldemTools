import * as React from "react";

type Parser<T> = (raw: string) => T;
type Serializer<T> = (value: T) => string;

export function useLocalStorageState<T>(
  key: string,
  defaultValue: T,
  parse: Parser<T>,
  serialize: Serializer<T> = (v: T) => JSON.stringify(v)
): readonly [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = React.useState<T>(() => {
    if (typeof window === "undefined") return defaultValue;
    const raw = window.localStorage.getItem(key);
    if (!raw) return defaultValue;

    try {
      return parse(raw);
    } catch {
      return defaultValue;
    }
  });

  React.useEffect((): void => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, serialize(value));
    } catch {
      // ignore quota / serialization errors
    }
  }, [key, serialize, value]);

  React.useEffect((): (() => void) | void => {
    if (typeof window === "undefined") return;

    const onStorage = (e: StorageEvent): void => {
      if (e.storageArea !== window.localStorage) return;
      if (e.key !== key) return;

      const nextRaw = e.newValue;
      if (!nextRaw) {
        setValue(defaultValue);
        return;
      }

      try {
        setValue(parse(nextRaw));
      } catch {
        setValue(defaultValue);
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [defaultValue, key, parse]);

  return [value, setValue] as const;
}
