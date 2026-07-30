'use client';

import { useState, useEffect, useSyncExternalStore } from 'react';

const emptySubscribe = () => () => {};

function getSnapshot() {
  return window.location.search;
}

function getServerSnapshot() {
  return '';
}

export function useClientSearchParams() {
  const search = useSyncExternalStore(emptySubscribe, getSnapshot, getServerSnapshot);
  const params = new URLSearchParams(search);

  const get = (key: string) => params.get(key);
  const getAll = () => params;

  return { get, getAll };
}
