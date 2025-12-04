import React from 'react'

interface TemplateLayoutProps {
  title?: string
  children?: React.ReactNode
}

export function TemplateLayout({ title, children }: TemplateLayoutProps) {
  return (
    <div className="max-w-5xl mx-auto">
      {title && (
        <div className="mb-4 border-b border-gray-200 pb-2">
          <h1 className="text-xl font-semibold">{title}</h1>
        </div>
      )}
      <div>{children}</div>
    </div>
  )}
