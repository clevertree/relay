import React from 'react';
import renderer from 'react-test-renderer';
import { MarkdownRenderer } from '../src/components/MarkdownRenderer';

describe('MarkdownRenderer', () => {
  it('renders basic markdown without crashing', () => {
    const tree = renderer.create(
      <MarkdownRenderer content={'# Hello\n\nThis is **bold** and *italic*.'} />
    ).toJSON();
    expect(tree).toBeTruthy();
  });
});
