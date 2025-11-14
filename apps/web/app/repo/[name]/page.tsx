
import React from 'react';
import RepositoryBrowser from '../../../src/components/RepositoryBrowser';

// Required for Next.js static export
export function generateStaticParams() {
  return [];
}

export default function RepoPage({ params }: { params: { name: string } }) {
  const name = params?.name ?? '';
  if (!name) return null;
  return <RepositoryBrowser repoName={name} />;
}
