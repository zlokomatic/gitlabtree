const CSS_PREFIX = 'gitlab-tree-plugin';
var EFileState;
(function (EFileState) {
    EFileState[EFileState["ADDED"] = 0] = "ADDED";
    EFileState[EFileState["UPDATED"] = 1] = "UPDATED";
    EFileState[EFileState["RENAMED"] = 2] = "RENAMED";
    EFileState[EFileState["DELETED"] = 3] = "DELETED";
})(EFileState || (EFileState = {}));
class GitLabTree {
    constructor() {
        this.wrapperElement = document.createElement('div');
        this.leftElement = document.createElement('div');
        this.rightElement = document.createElement('div');
        this.lastActive = '';
        // Detection if we are on GitLab page
        const isGitLab = document.querySelector('meta[content="GitLab"]');
        if (!isGitLab) {
            return;
        }
        this.init().then(() => {
            // Detection if we have any files to generate tree from
            const files = document.querySelector('.files');
            if (!files) {
                return;
            }
            this.fileHolders = files.querySelectorAll('.file-holder');
            if (!files || this.fileHolders.length === 0) {
                return;
            }
            files.classList.add(CSS_PREFIX);
            // Obtain metadata
            this.metadata = this.obtainMetadata();
            if (this.metadata.length === 0) {
                return;
            }
            this.obtainCommentedFiles();
            // Hide files
            this.copyAndHideFiles(files);
            // Analyze filenames
            this.fileNames = this.metadata.map(m => m.filename);
            this.pathPrefix = this.getPrefixPath(this.fileNames);
            this.strippedFileNames = this.removePathPrefix(this.fileNames, this.pathPrefix);
            // Create and display DOM
            const fileNamesDOM = this.convertFolderStructureToDOM(this.pathPrefix, this.createFolderStructure(this.strippedFileNames));
            this.leftElement.appendChild(fileNamesDOM);
            files.appendChild(this.wrapperElement);
            // Show file based on hash id
            const currentFileHash = location.hash;
            this.showFile(currentFileHash);
            // Add expanding feature
            this.expandListener = (e) => e.target.classList.contains('holder') ? this.toggleExpand(e) : undefined;
            document.addEventListener('click', this.expandListener);
            // Add listener for changes
            this.hashChangeListener = this.hashChanged.bind(this);
            window.addEventListener('hashchange', this.hashChangeListener);
        });
    }
    /**
     * Kind of destructor.
     */
    teardown() {
        window.removeEventListener('hashchange', this.hashChangeListener);
        document.removeEventListener('click', this.expandListener);
    }
    /**
     * Creates required DOM elements.
     */
    async init() {
        this.wrapperElement.appendChild(this.leftElement);
        this.wrapperElement.appendChild(this.rightElement);
        this.wrapperElement.classList.add(CSS_PREFIX + '-wrapper');
        this.leftElement.classList.add(CSS_PREFIX + '-left');
        this.rightElement.classList.add(CSS_PREFIX + '-right');
        this.databaseState = await this.obtainSeenState();
    }
    obtainSeenState() {
        return new Promise((resolve) => {
            chrome.storage.local.get((obj) => {
                resolve(obj);
            });
        });
    }
    /**
     * Collects basic information about files - their names, their hashes, and happend to them.
     *
     * @return {IMetadata} - collected metadata
     */
    obtainMetadata() {
        const metadataFiles_v10_3_and_latest = () => Array.prototype.slice.call(document.querySelectorAll('.diff-file-changes .dropdown-content li:not(.hidden)'));
        const metadataFiles_v9_5 = () => Array.prototype.slice.call(document.querySelectorAll('.file-stats li'));
        const files_latest = metadataFiles_v10_3_and_latest();
        if (files_latest.length > 0) {
            if (files_latest[0].querySelector('a i:first-child')) {
                return this.obtainMetadata_v10_3(files_latest);
            }
            else {
                return this.obtainMetadata_latest(files_latest);
            }
        }
        else {
            return this.obtainMetadata_v9_5(metadataFiles_v9_5());
        }
    }
    /**
     * It does obtain metadata for latest known version of Gitlab (Collects basic information about files - their names, their hashes and what happend to them).
     *
     * @param {HTMLElement[]} rawFilesMetadata - HTML elements of file changed in commit(s)
     */
    obtainMetadata_latest(rawFilesMetadata) {
        const metadata = [];
        for (let rawFileMetadata of rawFilesMetadata) {
            const svgElement = rawFileMetadata.querySelector('svg.diff-file-changed-icon');
            const typeRaw = svgElement.querySelector('use').getAttribute('xlink:href').split('#')[1];
            const hash = rawFileMetadata.querySelector('a').getAttribute('href');
            const filename = rawFileMetadata.querySelector('.diff-changed-file-path').textContent.trim();
            const isCred = svgElement.classList.contains('cred');
            let type = EFileState.UPDATED;
            // Convert type
            if (typeRaw === 'file-addition') {
                type = EFileState.ADDED;
            }
            if (typeRaw === 'file-deletion' && !isCred) {
                type = EFileState.RENAMED;
            }
            if (typeRaw === 'file-deletion' && isCred) {
                type = EFileState.DELETED;
            }
            // Save
            const fileMetadata = { type, hash, filename, commented: false };
            metadata.push(fileMetadata);
        }
        return metadata;
    }
    /**
     * It does obtain metadata for Gitlab < 10_3 (Collects basic information about files - their names, their hashes and what happend to them).
     * See https://github.com/tomasbonco/gitlabtree/issues/3
     * @param {HTMLElement[]} rawFilesMetadata - HTML elements of file changed in commit(s)
     */
    obtainMetadata_v10_3(rawFilesMetadata) {
        let metadata = [];
        for (let rawFileMetadata of rawFilesMetadata) {
            const classList = rawFileMetadata.querySelector('a i:first-child').classList;
            const hash = rawFileMetadata.querySelector('a').getAttribute('href');
            let filename = rawFileMetadata.querySelector('.diff-file-changes-path').textContent.trim();
            let type = EFileState.UPDATED;
            // When file renamed, show renamed file
            if (filename.indexOf('→') !== -1) {
                filename = filename.split('→')[1].trim();
            }
            // Convert type
            if (classList.contains('fa-plus')) {
                type = EFileState.ADDED;
            }
            if (classList.contains('fa-minus') && !classList.contains('cred')) {
                type = EFileState.RENAMED;
            }
            if (classList.contains('fa-minus') && classList.contains('cred')) {
                type = EFileState.DELETED;
            }
            // Save
            const fileMetadata = { type, hash, filename, commented: false };
            metadata.push(fileMetadata);
        }
        return metadata;
    }
    /**
     * It does obtain metadata for Gitlab < 9.5 (Collects basic information about files - their names, their hashes and what happend to them).
     * See https://github.com/tomasbonco/gitlabtree/issues/2
     * @param {HTMLElement[]} rawFilesMetadata - HTML elements of file changed in commit(s)
     */
    obtainMetadata_v9_5(rawFilesMetadata) {
        let metadata = [];
        for (let rawFileMetadata of rawFilesMetadata) {
            const typeRaw = Array.prototype.slice.call(rawFileMetadata.querySelector('span:first-child').classList);
            const hash = rawFileMetadata.querySelector('a').getAttribute('href');
            let filename = rawFileMetadata.querySelector('a').textContent.trim();
            let type = EFileState.UPDATED;
            // When file renamed, show renamed file
            if (filename.indexOf('→') !== -1) {
                filename = filename.split('→')[1].trim();
            }
            // Convert type
            if (~typeRaw.indexOf('new-file')) {
                type = EFileState.ADDED;
            }
            if (~typeRaw.indexOf('renamed-file')) {
                type = EFileState.RENAMED;
            }
            if (~typeRaw.indexOf('deleted-file')) {
                type = EFileState.DELETED;
            }
            // Save
            const fileMetadata = { type, hash, filename, commented: false };
            metadata.push(fileMetadata);
        }
        return metadata;
    }
    /**
     * Adds flag 'commented' in metadata to every file that was commented.
     */
    obtainCommentedFiles() {
        const fileHolders = Array.prototype.slice.call(this.fileHolders);
        fileHolders.forEach((fileHolder, index) => {
            const metadata = this.getMetadata(index);
            metadata.commented = !!fileHolder.querySelector('.notes_holder');
        });
    }
    /**
     * Returns metadata by index.
     *
     * @param {number} index - index
     * @return {IMetadata} - metadata
     */
    getMetadata(index) {
        return this.metadata[index];
    }
    /**
     * It loops through files listed (DOM elements), copies them to new DOM structure,
     * and hides them.
     *
     * @param {HTMLElement} files - DOM element with files listed
     */
    copyAndHideFiles(files) {
        for (let i = 0; i < this.fileHolders.length; i++) {
            let fileHolder = this.fileHolders[i];
            files.removeChild(fileHolder);
            this.rightElement.appendChild(fileHolder);
            fileHolder.classList.add(CSS_PREFIX + '-hidden');
        }
    }
    /**
     * It loops through files finding maximum common folder structure.
     *
     * @param {string[]} fileNames - list of filenames
     * @return {string} - maximum common folder path
     */
    getPrefixPath(fileNames) {
        if (!Array.isArray(fileNames)) {
            throw new Error(`Expected array, ${typeof fileNames} given!`);
        }
        if (fileNames.length === 0) {
            return '';
        }
        let sourcePathParts = fileNames[0].split('/');
        if (fileNames.length === 1) {
            sourcePathParts.pop();
            return sourcePathParts.join('/');
        }
        for (let i = 1; i < fileNames.length; i++) {
            let filePathParts = fileNames[i].split('/');
            for (let ii = 0; ii < sourcePathParts.length; ii++) {
                if (sourcePathParts[ii] !== filePathParts[ii]) {
                    sourcePathParts = sourcePathParts.slice(0, ii);
                    break;
                }
            }
        }
        return sourcePathParts.join('/');
    }
    /**
     * Removes path prefix from all fileNames.
     *
     * @param {string[]} fileNames - list of filenames
     * @param {string} prefix - prefix to be removed
     * @return {string[]} - trimmed filenames
     */
    removePathPrefix(fileNames, prefix) {
        if (prefix.length === 0) {
            return fileNames.slice(0);
        }
        let output = [];
        for (let fileName of fileNames) {
            output.push(fileName.substring((prefix + '/').length));
        }
        return output;
    }
    /**
     * Creates folder structure from given list of files.
     * Folders are objects, files are numbers.
     *
     * Example: [ test/foo/spec1.ts, test/foo/spec2.ts ] -> { test: { foo: { spec1: 0, spec1: 1 }}}
     *
     * @param {string} fileNames - list of filenames
     * @return {any} generated folder structure
     */
    createFolderStructure(fileNames) {
        let structure = {};
        if (!Array.isArray(fileNames) || fileNames.length === 0) {
            throw new Error(`Expected array, ${typeof fileNames} given!`);
        }
        for (let i = 0; i < fileNames.length; i++) {
            let fileName = fileNames[i];
            let fileNameParts = fileName.split('/');
            let currentFolder = structure;
            for (let ii = 0; ii < fileNameParts.length; ii++) {
                let part = fileNameParts[ii];
                if (!currentFolder[part]) {
                    if (ii === fileNameParts.length - 1) {
                        currentFolder[part] = i; // file
                    }
                    else {
                        currentFolder[part] = {}; // folder
                    }
                }
                currentFolder = currentFolder[part];
            }
        }
        return structure;
    }
    /**
     * Converts folder structure into DOM recursively.
     *
     * @param {string} folderName - name of the currently proceed folder
     * @param {string} structure - folder structure (for example see `createFolderStructure`)
     * @return {HTMLDivElement} corresponding folder structure
     */
    convertFolderStructureToDOM(folderName, structure) {
        let root = document.createElement('div');
        root.classList.add('folder');
        root.classList.add(CSS_PREFIX + '-folder-expanded');
        let holder = document.createElement('div');
        holder.classList.add('holder');
        holder.setAttribute('title', folderName);
        holder.textContent = folderName;
        root.appendChild(holder);
        let files = [];
        let folders = [];
        for (let name in structure) {
            if (structure.hasOwnProperty(name)) {
                let entry = structure[name];
                if (typeof entry === 'number') {
                    const metadata = this.getMetadata(entry);
                    let file = document.createElement('a');
                    file.setAttribute('href', metadata.hash);
                    file.classList.add('file');
                    // Color
                    let fileStateClass;
                    let fileSeenClass = CSS_PREFIX + '-file-seen';
                    switch (metadata.type) {
                        case EFileState.ADDED:
                            fileStateClass = CSS_PREFIX + '-file-added';
                            break;
                        case EFileState.RENAMED:
                            fileStateClass = CSS_PREFIX + '-file-renamed';
                            break;
                        case EFileState.DELETED:
                            fileStateClass = CSS_PREFIX + '-file-deleted';
                            break;
                        default:
                            fileStateClass = CSS_PREFIX + '-file-updated';
                            break;
                    }
                    if (metadata.type == EFileState.ADDED || metadata.type == EFileState.UPDATED) {
                        if (!this.databaseState[metadata.hash]) {
                            fileSeenClass = CSS_PREFIX + '-file-unseen';
                        }
                    }
                    // Was file commented?
                    if (metadata.commented) {
                        let commentElement = document.createElement('i');
                        commentElement.classList.add('fa', 'fa-comments-o', CSS_PREFIX + '-file-commented-icon');
                        file.appendChild(commentElement);
                    }
                    // Content
                    const contentElement = document.createElement('span');
                    contentElement.textContent = name;
                    file.appendChild(contentElement);
                    file.classList.add(fileStateClass);
                    file.classList.add(fileSeenClass);
                    files.push(file);
                }
                else {
                    folders.push(this.convertFolderStructureToDOM(name, entry));
                }
            }
        }
        folders.forEach((folder) => root.appendChild(folder));
        files.forEach((file) => root.appendChild(file));
        return root;
    }
    /**
     * Expands or collapses folder after click.
     *
     * @param {MouseEvent} event - click event on .holder element
     */
    toggleExpand(event) {
        let folder = event.target.parentElement;
        let isExpanded = folder.classList.contains(CSS_PREFIX + '-folder-expanded');
        let isMainFolder = document.querySelector(`.${CSS_PREFIX}-left > .folder`) === folder;
        if (!isMainFolder) {
            folder.classList.remove(CSS_PREFIX + '-folder-collapsed', CSS_PREFIX + '-folder-expanded');
            folder.classList.add(CSS_PREFIX + (isExpanded ? '-folder-collapsed' : '-folder-expanded'));
        }
    }
    /**
     * Callback called after hash has changed. It searches for "diff-[FILE ID]"" in hash,
     * and displays corresponding file (based on id).
     */
    hashChanged() {
        let newHash = location.hash;
        this.showFile(newHash);
    }
    /**
     * Shows file based on id.
     *
     * @param {number} id - id of file to be shown
     */
    showFile(hash) {
        if (this.metadata.length === 0) {
            return;
        }
        if (this.lastActive) {
            this.getFileHolderByHash(this.lastActive).classList.add(CSS_PREFIX + '-hidden');
            this.getFileLinkByHash(this.lastActive).classList.remove(CSS_PREFIX + '-file-active');
        }
        hash = this.metadata.filter(m => m.hash === hash).length > 0 ? hash : this.metadata[0].hash; // if hash is invalid use default hash
        this.getFileHolderByHash(hash).classList.remove(CSS_PREFIX + '-hidden');
        this.getFileLinkByHash(hash).classList.add(CSS_PREFIX + '-file-active');
        this.getFileLinkByHash(hash).classList.remove(CSS_PREFIX + '-file-unseen');
        this.databaseState[hash] = true;
        chrome.storage.local.set(this.databaseState);
        this.lastActive = hash;
    }
    getFileHolderByHash(hash) {
        return this.rightElement.querySelector(`[id='${hash.substr(1)}']`);
    }
    getFileLinkByHash(hash) {
        return this.leftElement.querySelector(`[href='${hash}']`);
    }
}
let instance = new GitLabTree();
/**
 * This is for fake AJAX re-renders of the page.
 */
function checkSiteChange() {
    let files = document.querySelector('.files');
    if (files && !files.classList.contains(CSS_PREFIX)) {
        instance.teardown();
        instance = new GitLabTree();
    }
}
setInterval(() => checkSiteChange(), 3000);
//# sourceMappingURL=inject.js.map