"use client";
import React, { useEffect } from 'react';
import { Chip } from '@mui/material';
import { startBridgeValidation, useBridgeStore } from '../lib/log';

export default function RuntimeChip() {
  const { validated, validating } = useBridgeStore();
  useEffect(() => {
    // Kick off validation on first render
    startBridgeValidation();
  }, []);
  const label = validated ? 'desktop' : (validating ? 'checking…' : 'web-only');
  const color: any = validated ? 'success' : 'primary';
  return <Chip label={label} color={color} size="small" />;
}
