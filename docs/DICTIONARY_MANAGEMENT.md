# Issue #6: Dictionary Management Plan

## Executive Summary

This document defines the complete strategy for managing translation dictionaries in kawa.i18n, covering data structures, conflict resolution, sync protocols, and user workflows.

**Status**: Pre-Phase 2 Decision Document
**Priority**: High (blocks Phase 2 implementation)

---

## Table of Contents

1. [Data Structures](#data-structures)
2. [Storage Architecture](#storage-architecture)
3. [Lifecycle Management](#lifecycle-management)
4. [Conflict Resolution](#conflict-resolution)
5. [Sync Strategy](#sync-strategy)
6. [User Workflows](#user-workflows)
7. [Error Handling](#error-handling)
8. [Performance Considerations](#performance-considerations)

---

## 1. Data Structures

### 1.1 Local Dictionary Format

**Location**: `~/.kawa-code/i18n/dictionaries/{origin}_{language}.json`

```typescript
interface LocalDictionary {
  // Identity
  origin: string              // Git remote URL (e.g., "github.com:user/repo")
  language: LanguageCode      // Target language ("ja", "fr", etc.)

  // Translation data
  terms: Record<string, string>    // English → Target mapping
  comments?: Record<string, CommentTranslation>  // Optional comments

  // Metadata
  metadata: {
    createdAt: string         // ISO timestamp
    updatedAt: string         // ISO timestamp
    lastSyncedAt?: string     // Last successful API sync (ISO)
    version: string           // Schema version (e.g., "1.0.0")

    // Conflict tracking
    localChanges?: string[]   // Terms modified locally since last sync
    conflicts?: Conflict[]    // Unresolved conflicts

    // Statistics
    totalTerms: number        // Count for quick display
    totalComments?: number    // Optional comment count
  }
}

interface CommentTranslation {
  en: string                  // English version
  [language: string]: string  // Translated versions
}

interface Conflict {
  term: string                // Conflicting term
  local: string               // Local translation
  remote: string              // Remote translation
  timestamp: string           // When conflict detected
  resolved?: boolean          // User resolved?
  chosenValue?: 'local' | 'remote' | 'custom'
  customValue?: string        // If user provided custom resolution
}
```

### 1.2 API Dictionary Format

**From API**: (see API_REVIEW.md)

```typescript
interface APIDictionary {
  origin: string
  language: string
  buckets: DictionaryBucket[]      // Daily buckets
  revisions: DictionaryRevision[]  // Alternative translations
}

interface DictionaryBucket {
  day: string                      // YYYY-MM-DD
  terms: Record<string, string>
  comments?: Record<string, CommentTranslation>
}
```

**Conversion Required**:
- API uses buckets → Extension uses flat `terms`
- Extension compiles buckets into single object
- Extension tracks `lastSyncedAt` for incremental sync

---

## 2. Storage Architecture

### 2.1 Directory Structure

```
~/.kawa-code/
├── i18n/
│   ├── dictionaries/              # Dictionary cache
│   │   ├── github_com_user_repo_ja.json
│   │   ├── github_com_user_repo_fr.json
│   │   └── gitlab_com_org_project_ja.json
│   ├── backups/                   # Auto-backups
│   │   ├── github_com_user_repo_ja_2024-12-06.json
│   │   └── github_com_user_repo_ja_2024-12-05.json
│   └── config.json                # Extension config
```

### 2.2 Filename Generation

```typescript
function getDictionaryFilename(origin: string, language: string): string {
  // Sanitize origin: remove protocol, replace special chars
  const sanitized = origin
    .replace(/^https?:\/\//, '')    // Remove protocol
    .replace(/\.git$/, '')           // Remove .git suffix
    .replace(/[^a-zA-Z0-9]/g, '_')  // Replace special chars
    .toLowerCase()

  return `${sanitized}_${language}.json`
}

// Examples:
// "https://github.com/user/repo.git" + "ja" → "github_com_user_repo_ja.json"
// "git@github.com:user/repo.git" + "fr" → "github_com_user_repo_fr.json"
```

### 2.3 Backup Strategy

**Auto-Backup Triggers**:
- Before sync (in case sync corrupts data)
- Before conflict resolution
- Daily (keep last 7 days)

**Backup Format**:
```
{filename}_{YYYY-MM-DD}.json
```

**Retention Policy**:
- Keep last 7 days
- Delete older backups automatically
- User can disable auto-backup in settings

---

## 3. Lifecycle Management

### 3.1 Dictionary Creation

**Trigger**: First time translating code from a repository

**Flow**:
```
1. User opens file from new repo
2. Extension detects no dictionary exists
3. Extension offers options:
   a) Create empty dictionary (manual term entry)
   b) Scan project and create dictionary (auto-populate)
   c) Download from API (if user has access)
4. User chooses option
5. Dictionary created locally
```

**Creation Options**:

#### Option A: Empty Dictionary
```typescript
{
  origin: "github.com:user/repo",
  language: "ja",
  terms: {},
  metadata: {
    createdAt: "2024-12-06T10:00:00Z",
    updatedAt: "2024-12-06T10:00:00Z",
    version: "1.0.0",
    totalTerms: 0
  }
}
```

#### Option B: Project Scan
```typescript
// Scan project → Send to API → Get translations
const identifiers = scanProject(repoRoot)
const translations = await api.translateProject(origin, language, identifiers, context)

// Save locally
saveDictionary({
  origin,
  language,
  terms: translations,
  metadata: {
    createdAt: now,
    updatedAt: now,
    version: "1.0.0",
    totalTerms: Object.keys(translations).length
  }
})
```

#### Option C: Download from API
```typescript
// Fetch existing dictionary from API
const apiDict = await api.getDictionary(origin, language)

// Save locally
saveDictionary({
  origin,
  language,
  terms: apiDict.terms,
  comments: apiDict.comments,
  metadata: {
    createdAt: now,
    updatedAt: now,
    lastSyncedAt: now,
    version: "1.0.0",
    totalTerms: Object.keys(apiDict.terms).length
  }
})
```

### 3.2 Dictionary Loading

**On Extension Start**:
1. Load all dictionaries from cache directory
2. Build index: `Map<origin_language, Dictionary>`
3. Validate schema version
4. Migrate if needed

**On Translation Request**:
1. Check cache for dictionary
2. If found: use immediately
3. If not found: offer to create

### 3.3 Dictionary Updates

**Local Updates** (Phase 2-4):
```typescript
function addTerms(origin: string, language: string, newTerms: Record<string, string>): void {
  const dict = loadDictionary(origin, language)

  // Merge terms
  dict.terms = { ...dict.terms, ...newTerms }

  // Update metadata
  dict.metadata.updatedAt = new Date().toISOString()
  dict.metadata.totalTerms = Object.keys(dict.terms).length

  // Track local changes (for sync)
  dict.metadata.localChanges = dict.metadata.localChanges || []
  dict.metadata.localChanges.push(...Object.keys(newTerms))

  saveDictionary(dict)
}
```

**API Sync** (Phase 5):
```typescript
async function syncDictionary(origin: string, language: string): Promise<void> {
  const local = loadDictionary(origin, language)

  // Push local changes
  if (local.metadata.localChanges && local.metadata.localChanges.length > 0) {
    await api.addTerms(origin, language, getChangedTerms(local))
    local.metadata.localChanges = []
  }

  // Pull remote changes
  const since = local.metadata.lastSyncedAt
  const remote = await api.getDictionary(origin, language, since)

  // Merge and resolve conflicts
  const merged = mergeWithConflictDetection(local, remote)

  // Update sync timestamp
  merged.metadata.lastSyncedAt = new Date().toISOString()
  merged.metadata.updatedAt = new Date().toISOString()

  saveDictionary(merged)
}
```

### 3.4 Dictionary Deletion

**Triggers**:
- User manually deletes
- Repository removed from system
- User request

**Process**:
1. Create final backup
2. Remove from cache
3. Optionally delete from API (ask user)

---

## 4. Conflict Resolution

### 4.1 Conflict Detection

**When Conflicts Occur**:
- Same term translated differently locally vs remotely
- Both parties modified same term since last sync

**Detection Logic**:
```typescript
function detectConflicts(local: Dictionary, remote: Dictionary): Conflict[] {
  const conflicts: Conflict[] = []

  for (const [term, remoteTrans] of Object.entries(remote.terms)) {
    const localTrans = local.terms[term]

    // Check if term was changed locally
    const wasChangedLocally = local.metadata.localChanges?.includes(term)

    // Conflict if:
    // 1. Term exists in both
    // 2. Values differ
    // 3. Local was changed (not just old cached value)
    if (localTrans && localTrans !== remoteTrans && wasChangedLocally) {
      conflicts.push({
        term,
        local: localTrans,
        remote: remoteTrans,
        timestamp: new Date().toISOString()
      })
    }
  }

  return conflicts
}
```

### 4.2 Resolution Strategies

#### Strategy 1: Last-Write-Wins (Default for Phase 5)

**Simplest approach**:
```typescript
function mergeLastWriteWins(local: Dictionary, remote: Dictionary): Dictionary {
  // Remote always wins
  return {
    ...local,
    terms: { ...local.terms, ...remote.terms },
    comments: { ...local.comments, ...remote.comments }
  }
}
```

**Pros**:
- Simple to implement
- No user intervention
- Fast

**Cons**:
- Can lose local changes
- No user control

**When to Use**: Phase 5 initial implementation

---

#### Strategy 2: Conflict Marking (Phase 6+)

**Store conflicts, let user decide**:
```typescript
function mergeWithConflictMarking(local: Dictionary, remote: Dictionary): Dictionary {
  const conflicts = detectConflicts(local, remote)

  if (conflicts.length > 0) {
    // Store conflicts in metadata
    local.metadata.conflicts = conflicts

    // Use remote values by default, but mark as conflicted
    for (const conflict of conflicts) {
      local.terms[conflict.term] = conflict.remote  // Use remote temporarily
    }

    // Notify user
    notifyUser(`${conflicts.length} conflicts detected. Review in settings.`)
  }

  // Merge non-conflicting terms
  for (const [term, trans] of Object.entries(remote.terms)) {
    if (!conflicts.find(c => c.term === term)) {
      local.terms[term] = trans
    }
  }

  return local
}
```

**User Resolution UI** (Muninn or VSCode):
```
Conflict detected for term "calculate":
  Local:  "計算する"
  Remote: "算出する"

Choose resolution:
  ○ Use local translation
  ● Use remote translation
  ○ Use custom: [ ___________ ]

[Resolve All] [Resolve This]
```

---

#### Strategy 3: Three-Way Merge (Advanced - Phase 8+)

**Use common ancestor**:
```typescript
function mergeThreeWay(local: Dictionary, remote: Dictionary, base: Dictionary): Dictionary {
  const merged = { ...local }

  for (const [term, remoteTrans] of Object.entries(remote.terms)) {
    const localTrans = local.terms[term]
    const baseTrans = base.terms[term]

    if (localTrans === remoteTrans) {
      // No conflict
      merged.terms[term] = remoteTrans
    } else if (!baseTrans) {
      // New term in both - conflict
      merged.metadata.conflicts.push({ term, local: localTrans, remote: remoteTrans })
    } else if (localTrans === baseTrans) {
      // Only remote changed - use remote
      merged.terms[term] = remoteTrans
    } else if (remoteTrans === baseTrans) {
      // Only local changed - use local
      merged.terms[term] = localTrans
    } else {
      // Both changed differently - conflict
      merged.metadata.conflicts.push({ term, local: localTrans, remote: remoteTrans })
    }
  }

  return merged
}
```

**Requires**:
- Tracking common ancestor state
- More complex implementation
- Better user experience

---

### 4.3 Recommended Approach

**Phase 5**: Last-Write-Wins
- Simple, no UI needed
- Remote always wins
- Document in user guide

**Phase 6**: Conflict Marking
- Store conflicts in metadata
- Add resolution UI
- User chooses per conflict

**Phase 8**: Three-Way Merge
- Full git-like merge
- Smart conflict detection
- Best UX

---

## 5. Sync Strategy

### 5.1 Sync Modes

#### Mode 1: Manual Sync (Phase 5)
```typescript
// User triggers sync via command
await syncDictionary(origin, language)
```

**Triggers**:
- User command: "Sync Dictionary"
- Button in Muninn UI
- Keyboard shortcut

**Frequency**: On-demand

---

#### Mode 2: Auto-Sync on File Open (Phase 5)
```typescript
// When file opened, check if sync needed
onFileOpen(async (file) => {
  const dict = getDictionary(file.origin, userLanguage)

  if (shouldSync(dict)) {
    await syncDictionary(dict.origin, dict.language)
  }
})

function shouldSync(dict: Dictionary): boolean {
  const lastSync = new Date(dict.metadata.lastSyncedAt || 0)
  const now = new Date()
  const hoursSinceSync = (now.getTime() - lastSync.getTime()) / (1000 * 60 * 60)

  return hoursSinceSync > 24  // Sync if >24 hours old
}
```

**Frequency**: Once per day max

---

#### Mode 3: Periodic Background Sync (Phase 6)
```typescript
// Background sync every N minutes
setInterval(async () => {
  const activeDicts = getActiveDictionaries()

  for (const dict of activeDicts) {
    try {
      await syncDictionary(dict.origin, dict.language)
    } catch (error) {
      logger.error(`Sync failed: ${error}`)
    }
  }
}, 5 * 60 * 1000)  // Every 5 minutes
```

**Frequency**: Configurable (default 5 min)

---

### 5.2 Incremental Sync

**Concept**: Only fetch changes since last sync

**Implementation**:
```typescript
async function incrementalSync(origin: string, language: string): Promise<void> {
  const local = loadDictionary(origin, language)
  const since = local.metadata.lastSyncedAt

  // API supports 'since' parameter
  const updates = await api.getDictionary(origin, language, since)

  // Merge only new/changed terms
  for (const [term, trans] of Object.entries(updates.terms)) {
    local.terms[term] = trans
  }

  local.metadata.lastSyncedAt = new Date().toISOString()
  saveDictionary(local)
}
```

**Benefits**:
- Faster (less data)
- Lower bandwidth
- Reduced API load

**API Support**: ✅ Already implemented (see API_REVIEW.md)

---

### 5.3 Offline Support

**Behavior**: Extension works fully offline

**Strategy**:
1. **Read**: Always use local cache
2. **Write**: Queue changes locally
3. **Sync**: Push queued changes when online

**Implementation**:
```typescript
interface SyncQueue {
  origin: string
  language: string
  pendingTerms: Record<string, string>
  timestamp: string
}

// Queue changes when offline
function addTermsOffline(origin: string, language: string, terms: Record<string, string>): void {
  const queue = loadSyncQueue()
  queue.push({ origin, language, pendingTerms: terms, timestamp: new Date().toISOString() })
  saveSyncQueue(queue)
}

// Process queue when online
async function processSyncQueue(): Promise<void> {
  const queue = loadSyncQueue()

  for (const item of queue) {
    try {
      await api.addTerms(item.origin, item.language, item.pendingTerms)
      queue.shift()  // Remove from queue
    } catch (error) {
      break  // Stop on first failure
    }
  }

  saveSyncQueue(queue)
}
```

---

## 6. User Workflows

### 6.1 First-Time Setup

**Scenario**: User wants to translate code for the first time

**Steps**:
1. User opens TypeScript file in VSCode
2. User triggers "Translate to Japanese"
3. Extension detects no dictionary exists
4. Extension prompts:
   ```
   No dictionary found for this repository.

   How would you like to create one?

   [Scan Project] [Create Empty] [Download from Cloud]
   ```
5. User chooses option
6. Dictionary created and cached
7. Translation proceeds

---

### 6.2 Adding New Terms

**Scenario**: User encounters untranslated identifier

**Flow**:
```
1. User translates file
2. Extension shows: "3 untranslated terms: calculateSum, getData, processResult"
3. User clicks "Add Translations"
4. Extension sends terms to API for AI translation
5. API returns translations
6. User reviews translations (optional)
7. Terms added to local dictionary
8. File re-translated with new terms
```

**UI** (VSCode notification):
```
Translation complete! 47/50 terms translated.

3 terms need translation:
  - calculateSum
  - getData
  - processResult

[Translate Now] [Add Manually] [Ignore]
```

---

### 6.3 Manual Term Entry

**Scenario**: User wants custom translation (not AI-generated)

**Flow**:
```
1. User opens dictionary editor (Muninn UI or VSCode panel)
2. User adds term:
   English: "calculateSum"
   Japanese: "合計を計算"
3. Term saved to local dictionary
4. Optionally push to API
```

**UI** (Muninn dictionary editor):
```
Dictionary: github.com/user/repo (Japanese)

[Add Term] [Import CSV] [Export CSV]

Term                 Translation        Source    Modified
--------------------------------------------------------------
Calculator           計算機             AI        2024-12-05
add                  追加する           AI        2024-12-05
calculateSum         合計を計算         Manual    2024-12-06 ← New
```

---

### 6.4 Team Collaboration

**Scenario**: Multiple team members use same dictionary

**Flow**:
```
1. Team member A adds terms locally
2. A pushes to API (manual sync or auto)
3. Team member B pulls from API
4. B receives A's new terms
5. Both have same dictionary
```

**Conflict Example**:
```
1. A and B both offline
2. A translates "calculate" → "計算する"
3. B translates "calculate" → "算出する"
4. A syncs first (wins)
5. B syncs, detects conflict
6. B chooses resolution (see Conflict Resolution)
```

---

### 6.5 Dictionary Migration

**Scenario**: Moving from old translation-extension to kawa.i18n

**Migration Tool**:
```typescript
async function migrateDictionaries(): Promise<void> {
  const oldDir = path.join(homeDir, '.kawa-code', 'translation', 'dictionaries')
  const newDir = path.join(homeDir, '.kawa-code', 'i18n', 'dictionaries')

  const files = fs.readdirSync(oldDir)

  for (const file of files) {
    const oldDict = JSON.parse(fs.readFileSync(path.join(oldDir, file)))

    // Convert format if needed
    const newDict = convertFormat(oldDict)

    fs.writeFileSync(path.join(newDir, file), JSON.stringify(newDict, null, 2))
  }

  console.log(`Migrated ${files.length} dictionaries`)
}
```

---

## 7. Error Handling

### 7.1 Sync Failures

**Network Errors**:
```typescript
try {
  await syncDictionary(origin, language)
} catch (error) {
  if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
    // Offline - use local cache
    logger.warn('Sync failed: offline. Using local cache.')
    notifyUser('Working offline. Changes will sync when connection restored.')
  } else {
    throw error
  }
}
```

**API Errors**:
```typescript
try {
  await api.addTerms(origin, language, terms)
} catch (error) {
  if (error.status === 401) {
    // Auth failed - re-authenticate
    await reauthenticate()
    retry()
  } else if (error.status === 429) {
    // Rate limited - back off
    await sleep(60000)  // Wait 1 minute
    retry()
  } else if (error.status === 500) {
    // Server error - use local only
    logger.error('API error: using local cache')
  }
}
```

### 7.2 Corruption Detection

**Validate on Load**:
```typescript
function loadDictionary(origin: string, language: string): Dictionary {
  const dict = JSON.parse(fs.readFileSync(path))

  // Validate schema
  if (!dict.origin || !dict.language || !dict.terms) {
    throw new Error('Corrupted dictionary: missing required fields')
  }

  // Validate types
  if (typeof dict.terms !== 'object') {
    throw new Error('Corrupted dictionary: invalid terms structure')
  }

  // Restore from backup if corrupted
  if (isCorrupted(dict)) {
    return restoreFromBackup(origin, language)
  }

  return dict
}
```

### 7.3 Backup Restoration

```typescript
function restoreFromBackup(origin: string, language: string): Dictionary {
  const backupDir = path.join(cacheDir, '..', 'backups')
  const backups = fs.readdirSync(backupDir)
    .filter(f => f.startsWith(getDictionaryFilename(origin, language)))
    .sort()
    .reverse()  // Most recent first

  for (const backup of backups) {
    try {
      const dict = JSON.parse(fs.readFileSync(path.join(backupDir, backup)))

      if (!isCorrupted(dict)) {
        logger.info(`Restored from backup: ${backup}`)
        return dict
      }
    } catch {
      continue
    }
  }

  throw new Error('No valid backup found')
}
```

---

## 8. Performance Considerations

### 8.1 Large Dictionaries

**Problem**: Dictionaries can grow to 10,000+ terms

**Solutions**:
1. **Lazy Loading**: Only load dictionaries when needed
2. **Indexing**: Build term index for fast lookup
3. **Compression**: Gzip dictionary files on disk
4. **Pagination**: For UI, paginate term lists

### 8.2 Sync Optimization

**Batch Updates**:
```typescript
// Instead of syncing every term individually
for (const term of newTerms) {
  await api.addTerm(term)  // Bad: N requests
}

// Batch them
await api.addTerms(newTerms)  // Good: 1 request
```

**Debouncing**:
```typescript
// Don't sync on every keystroke
const debouncedSync = debounce(syncDictionary, 5000)  // Wait 5s after last change
```

### 8.3 Cache Strategy

**Memory Cache** (for active dictionaries):
```typescript
class DictionaryCache {
  private cache: Map<string, Dictionary> = new Map()

  get(origin: string, language: string): Dictionary {
    const key = `${origin}_${language}`

    if (!this.cache.has(key)) {
      this.cache.set(key, loadFromDisk(origin, language))
    }

    return this.cache.get(key)!
  }
}
```

**Eviction**: LRU (Least Recently Used) when cache > 10 dictionaries

---

## Summary

### Key Decisions

1. **Storage**: Local-first with optional cloud sync
2. **Conflict Resolution**: Last-write-wins initially, upgrade to conflict marking
3. **Sync Strategy**: Manual initially, add auto-sync later
4. **Data Format**: Compatible with existing API schema
5. **Offline Support**: Fully functional offline, queue syncs

### Implementation Priority

**Phase 2-4** (Local-only):
- ✅ Local dictionary storage
- ✅ Simple add/load/save
- ✅ No sync complexity
- ✅ No conflicts

**Phase 5** (API Integration):
- 🔨 API client
- 🔨 Manual sync
- 🔨 Last-write-wins conflicts
- 🔨 Basic error handling

**Phase 6+** (Advanced):
- 📋 Conflict marking UI
- 📋 Auto-sync
- 📋 Three-way merge
- 📋 Team features

### Success Criteria

- ✅ Dictionaries persist locally
- ✅ Schema compatible with API
- ✅ Graceful offline operation
- ✅ Conflict detection works
- ✅ Users don't lose data
- ✅ Team collaboration supported

---

**Status**: ✅ Dictionary Management Plan Complete

**Next**: Move to Issue #4 (Multi-Language Strategy)
