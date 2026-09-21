# Published article media

Article readers can view deliberately published images and PDFs without receiving
access to original conversations or their attachments. Published article media is
an independent, operator-managed store configured with `WIKI_ARTICLE_MEDIA`.
It never falls back to the evidence provider or `WIKI_TRACES`.

The supported article paths are content-addressed:

```text
/article-media/<sha256>.png
/article-media/<sha256>.jpg
/article-media/<sha256>.jpeg
/article-media/<sha256>.gif
/article-media/<sha256>.webp
/article-media/<sha256>.pdf
```

Readers, editors and managers may fetch these paths. Agents need `wiki:read`.
Signed-out, ungranted and revoked callers are denied. `/media/`, `/files/` and
the evidence APIs remain restricted to editors/managers and `wiki:trace` agents.
The engine's `/assets/` namespace remains reserved for bundled application files.

## Publish an approved file

Publication is direct-storage operator administration, separate from normal
article editing. The command copies one reviewed file into the configured store,
checks its extension and file signature, computes its SHA-256 identity, and writes
an immutable provenance manifest. Complete staged files are installed atomically
without replacing an existing publication, so an interrupted attempt can be
retried with the same input. It does not modify an article or retrieve a
restricted source.

```sh
export WIKI_ARTICLE_MEDIA=/absolute/private/article-media
node scripts/publish-article-media.mjs /absolute/reviewed/diagram.png \
  --source 'drive:file-id-or-other-stable-source-id' \
  --source-url 'https://source.example/original' \
  --source-date '2026-09-20' \
  --name 'System diagram'
```

`--source` is required. The optional source URL must use HTTP or HTTPS and may not
contain credentials. The command prints machine-readable JSON containing the
article URL. It never prints the source bytes. Repeating the same publication is
safe; trying to attach different provenance to an already published hash fails
for operator review.

After publication, an editor adds the returned URL through the ordinary Markdown
workflow:

```markdown
![System diagram](/article-media/<sha256>.png)

[Open the approved report](/article-media/<sha256>.pdf)
```

The article Git commit is the publication decision visible to readers. Article
sources or prose should explain why the selected copy is relevant; the operator
manifest records where the bytes came from. There is deliberately no remote upload
API and no implicit promotion of a trace attachment.

## Immutability, revisions and recovery

The store contains `assets/<hash>.<extension>` and a corresponding
`manifests/<hash>.<extension>.json`. The server requires both, checks the manifest,
size and complete file hash before serving, and supports a single HTTP byte range.
Disguised formats, changed files, unknown hashes and path traversal fail closed.

Do not overwrite or delete an asset during an ordinary article edit. Removing a
link creates a new article revision; readers can still open the older Git revision,
so its immutable media URL must remain available. Any future retention process
must consider every retained article revision, not only the current Markdown tree.

Back up and restore the complete article-media directory together with the content
Git repository and control database while writers and publication are stopped.
The store is authoritative and cannot be rebuilt from the content repository.
After restore, verify every manifest/hash pair before reopening the service. The
usual control-store recovery procedure still applies: invalidate restored sessions,
invitations and agent credentials as required before serving private content.
