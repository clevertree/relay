"use client";
import React from 'react';
import { useParams } from 'next/navigation';
import RepositoryBrowser from '../../../src/components/RepositoryBrowser';

export default function RepoPage() {
  const params = useParams<{ name: string }>();
  const name = (params?.name as string) || '';
  if (!name) return null;
  return <RepositoryBrowser repoName={name} />;
}
