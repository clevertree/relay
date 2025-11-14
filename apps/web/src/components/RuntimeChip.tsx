"use client";
import React, { useEffect, useState } from 'react';
import { Chip } from '@mui/material';
import { isDesktopRuntime } from '../lib/runtime';

export default function RuntimeChip() {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    setIsDesktop(isDesktopRuntime());
  }, []);
  return <Chip label={isDesktop ? 'desktop' : 'web-only'} color={isDesktop ? 'success' : 'primary'} size="small" />;
}
