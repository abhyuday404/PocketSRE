import { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import type { TrackedProject } from '@pocketsre/contracts';
const api = vi.hoisted(() => ({ projects: vi.fn(), files: vi.fn(), save: vi.fn() }));
vi.mock('react-native', () => ({
  Text: 'Text',
  View: 'View',
  ScrollView: 'ScrollView',
  Modal: 'Modal',
  Pressable: 'Pressable',
  ActivityIndicator: 'ActivityIndicator',
}));
vi.mock('./ui', () => ({ Button: 'Button', Icon: 'Icon', ui: {} }));
vi.mock('./ProjectConversations', () => ({ ProjectConversations: 'ProjectConversations' }));
vi.mock('./ModelPicker', () => ({ ModelPicker: 'ModelPicker' }));
vi.mock('./TempChat', () => ({ TempChat: 'TempChat' }));
vi.mock('../api/gateway', () => ({
  fetchProjects: api.projects,
  fetchProjectFiles: api.files,
  saveProjectSource: api.save,
}));
import { ProjectAgent } from './ProjectAgent';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
it('switches projects in the header and ignores a late file response from the previous project', async () => {
  const first = {
    id: 'first',
    repository: { id: 1, fullName: 'owner/one', private: true, defaultBranch: 'main' },
    sourcePaths: [],
  } as unknown as TrackedProject;
  const second = {
    ...first,
    id: 'second',
    repository: { ...first.repository, id: 2, fullName: 'owner/two' },
  };
  api.projects.mockResolvedValue([first, second]);
  let resolveFirst!: (value: unknown) => void;
  api.files.mockImplementation((id: string) =>
    id === 'first'
      ? new Promise((resolve) => {
          resolveFirst = resolve;
        })
      : Promise.resolve({ paths: ['two.ts'], truncated: false }),
  );
  let view!: ReactTestRenderer;
  function Harness() {
    const [project, setProject] = useState<TrackedProject | null>(null);
    return (
      <ProjectAgent
        project={project}
        busy={false}
        generate={vi.fn()}
        onModelChange={vi.fn()}
        onOpenSettings={vi.fn()}
        onChangeProject={setProject}
        onAddProject={vi.fn()}
        chat={vi.fn()}
      />
    );
  }
  await act(async () => {
    view = create(<Harness />);
  });
  try {
    await act(async () => {
      view.root.findByProps({ accessibilityLabel: 'Switch agent project' }).props.onPress();
    });
    await act(async () => {
      view.root.findByProps({ accessibilityLabel: 'Use project owner/two' }).props.onPress();
    });
    await act(async () => {
      resolveFirst({ paths: ['one.ts'], truncated: false });
    });
    const child = view.root.findByProps({ projectId: 'second' });
    expect(child.props.chatFiles.paths).toEqual(['two.ts']);
    await child.props.chatFiles.prepare(['two.ts']);
    expect(api.save).toHaveBeenCalledWith('second', ['two.ts']);
  } finally {
    await act(async () => view.unmount());
  }
});
