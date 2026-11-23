// Projects on this device: listing, creating, copying, deleting, and the
// project file that carries one project and its media between devices.

import { newId, newProject, parseProject, type Project } from '../doc/model';
import { allClips, projectDuration } from '../doc/ops';
import { projectFolder } from '../editor';
import { loadDocument, saveDocument, type Store } from '../store/store';
import { unzip, zip, type ZipEntry } from '../util/zip';

export interface Summary {
  id: string;
  name: string;
  duration: number;
  modified: number;
  width: number;
  height: number;
  /** A saved project that can no longer be read. It is listed, never overwritten. */
  damaged: boolean;
  thumb: Blob | null;
}

const extension = (name: string): string => /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1]?.toLowerCase() ?? 'bin';
const mediaPath = (id: string, m: { id: string; name: string }): string => `${projectFolder(id)}/media/${m.id}.${extension(m.name)}`;

export async function listProjects(store: Store): Promise<Summary[]> {
  const out: Summary[] = [];
  for (const id of await store.list('projects')) {
    if (!/^[a-z0-9-]{1,40}$/.test(id)) continue;
    const loaded = await loadDocument(store, `${projectFolder(id)}/project`);
    const project = loaded.text ? parseProject(loaded.text) : null;
    if (!project) {
      // A folder with media but no project yet is an import that never finished.
      if (!loaded.damaged) continue;
      out.push({ id, name: 'Damaged project', duration: 0, modified: 0, width: 16, height: 9, damaged: true, thumb: null });
      continue;
    }
    out.push({
      id,
      name: project.name,
      duration: projectDuration(project),
      modified: project.modified,
      width: project.width,
      height: project.height,
      damaged: false,
      thumb: await store.file(`${projectFolder(id)}/thumb.jpg`),
    });
  }
  return out.sort((a, b) => b.modified - a.modified);
}

async function writeProject(store: Store, id: string, project: Project): Promise<void> {
  await saveDocument(store, `${projectFolder(id)}/project`, 0, JSON.stringify(project));
}

export async function createProject(store: Store, name: string, width: number, height: number, photoDuration: number): Promise<string> {
  const id = newId();
  const project = newProject(name, width, height);
  project.photoDuration = photoDuration;
  await writeProject(store, id, project);
  return id;
}

async function readProject(store: Store, id: string): Promise<Project> {
  const loaded = await loadDocument(store, `${projectFolder(id)}/project`);
  const project = loaded.text ? parseProject(loaded.text) : null;
  if (!project) throw new Error('This project cannot be read');
  return project;
}

export async function renameProject(store: Store, id: string, name: string): Promise<void> {
  const loaded = await loadDocument(store, `${projectFolder(id)}/project`);
  const project = loaded.text ? parseProject(loaded.text) : null;
  if (!project) throw new Error('This project cannot be read');
  project.name = name;
  await saveDocument(store, `${projectFolder(id)}/project`, loaded.seq, JSON.stringify(project));
}

export async function duplicateProject(store: Store, id: string, onProgress: (fraction: number) => void): Promise<string> {
  const project = await readProject(store, id);
  const copy = newId();
  try {
    for (let i = 0; i < project.media.length; i++) {
      const m = project.media[i]!;
      const file = await store.file(mediaPath(id, m));
      if (file) await store.write(mediaPath(copy, m), file, (f) => onProgress((i + f) / project.media.length));
    }
    const thumb = await store.file(`${projectFolder(id)}/thumb.jpg`);
    if (thumb) await store.write(`${projectFolder(copy)}/thumb.jpg`, thumb);
    project.name = `${project.name} copy`.slice(0, 60);
    project.created = project.modified = Date.now();
    await writeProject(store, copy, project);
  } catch (err) {
    await store.remove(projectFolder(copy));
    throw err;
  }
  return copy;
}

export function deleteProject(store: Store, id: string): Promise<void> {
  return store.remove(projectFolder(id));
}

/** One file holding the project and every media file it uses. */
export async function exportProjectFile(store: Store, id: string, onProgress: (fraction: number) => void): Promise<{ blob: Blob; name: string }> {
  const project = await readProject(store, id);
  const used = new Set(allClips(project).map((c) => c.mediaId));
  project.media = project.media.filter((m) => used.has(m.id));
  const entries: ZipEntry[] = [{ name: 'project.json', blob: new Blob([JSON.stringify(project)]) }];
  for (const m of project.media) {
    const file = await store.file(mediaPath(id, m));
    if (!file) throw new Error(`"${m.name}" is missing from this device`);
    entries.push({ name: `media/${m.id}.${extension(m.name)}`, blob: file });
  }
  return { blob: await zip(entries, onProgress), name: project.name };
}

/** Unpacks a project file into a new project. Nothing is kept if any part of it is wrong. */
export async function importProjectFile(store: Store, file: Blob, onProgress: (fraction: number) => void): Promise<string> {
  const entries = await unzip(file, (f) => onProgress(f * 0.3));
  const manifest = entries.find((e) => e.name === 'project.json');
  if (!manifest || manifest.blob.size > 8 << 20) throw new Error('Not a project file');
  const project = parseProject(new TextDecoder().decode(await manifest.blob.arrayBuffer()));
  if (!project) throw new Error('Not a project file');
  // Every file the project refers to must be there: a cut-short file is refused, not opened with holes.
  const files = new Map(entries.map((e) => [e.name, e.blob]));
  for (const m of project.media) {
    if (!files.has(`media/${m.id}.${extension(m.name)}`)) throw new Error('Damaged project file');
  }
  const id = newId();
  try {
    for (let i = 0; i < project.media.length; i++) {
      const m = project.media[i]!;
      await store.write(mediaPath(id, m), files.get(`media/${m.id}.${extension(m.name)}`)!, (f) =>
        onProgress(0.3 + (0.7 * (i + f)) / project.media.length),
      );
    }
    project.modified = Date.now();
    await writeProject(store, id, project);
  } catch (err) {
    await store.remove(projectFolder(id));
    throw err;
  }
  return id;
}
