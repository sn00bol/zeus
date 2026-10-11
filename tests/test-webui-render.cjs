const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

class FakeElement {
    constructor(tagName) {
        this.tagName = tagName;
        this.children = [];
        this.attributes = {};
        this.listeners = {};
        this.dataset = {};
    }

    append(...children) {
        this.children.push(...children);
    }

    replaceChildren(...children) {
        this.children = [...children];
    }

    setAttribute(name, value) {
        this.attributes[name] = value;
    }

    addEventListener(name, callback) {
        this.listeners[name] = callback;
    }

    remove() {
        this.removed = true;
    }

    get childElementCount() {
        return this.children.length;
    }
}

test('search sources render as footer links, including multiple URLs from one host', async () => {
    global.document = {
        createElement: tagName => new FakeElement(tagName),
    };
    const source = await fs.readFile(
        path.join(__dirname, '..', 'webui', 'js', 'streamaddon.js'),
        'utf8',
    );
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    const { renderStreamDetails, removeInlineSourceCitations } = await import(moduleUrl);
    const container = new FakeElement('div');

    renderStreamDetails(container, {
        sources: [
            { title: 'First article', url: 'https://example.test/first' },
            { title: 'Second article', url: 'https://example.test/second' },
            { title: 'Duplicate article', url: 'https://example.test/first' },
            { title: 'Unsafe', url: 'javascript:alert(1)' },
        ],
    });

    const [footer] = container.children;
    assert.equal(footer.tagName, 'footer');
    assert.equal(footer.className, 'source-footer');
    assert.equal(footer.children[0].textContent, 'Sources');
    const links = footer.children[1].children;
    assert.equal(links.length, 2);
    assert.deepEqual(links.map(link => link.href), [
        'https://example.test/first',
        'https://example.test/second',
    ]);
    assert.deepEqual(links.map(link => link.target), ['_blank', '_blank']);
    assert.deepEqual(links.map(link => link.rel), [
        'noopener noreferrer',
        'noopener noreferrer',
    ]);
    assert.deepEqual(links.map(link => link.attributes['aria-label']), [
        'Open source: First article',
        'Open source: Second article',
    ]);
    assert.deepEqual(links.map(link => link.children[0].src), [
        'https://www.google.com/s2/favicons?domain=example.test&sz=32',
        'https://www.google.com/s2/favicons?domain=example.test&sz=32',
    ]);
    assert.deepEqual(links.map(link => link.children[0].loading), ['eager', 'eager']);
    assert.deepEqual(links.map(link => link.children[0].fetchPriority), ['low', 'low']);
    assert.deepEqual(links.map(link => link.children[1].textContent), [
        'First article',
        'Second article',
    ]);
    assert.match(links[0].innerHTML, /<svg/);
    links[0].children[0].listeners.load();
    assert.equal(links[0].dataset.hasFavicon, 'true');
    links[0].children[0].listeners.error();
    assert.equal(links[0].children[0].removed, true);
    assert.equal(links[0].dataset.hasFavicon, 'false');
    const answer = removeInlineSourceCitations(
        'The report compares several outlets【3】【4】【9】 (VnExpress, Saostar, Lao Động). [1] Other context stays.',
        [
            { url: 'https://vnexpress.net/article' },
            { url: 'https://saostar.vn/article' },
            { url: 'https://laodong.vn/article' },
        ],
    );
    assert.equal(answer, 'The report compares several outlets. Other context stays.');
});

test('stream details show prompt and answer token usage, not the model context window', async () => {
    global.document = {
        createElement: tagName => new FakeElement(tagName),
    };
    const source = await fs.readFile(
        path.join(__dirname, '..', 'webui', 'js', 'streamaddon.js'),
        'utf8',
    );
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    const { renderStreamDetails } = await import(moduleUrl);
    const container = new FakeElement('div');

    renderStreamDetails(container, {
        prompt_tokens: 1234,
        completion_tokens: 567,
        context_length: 131072,
    });

    const usage = container.children.find(child => child.className === 'stream-details-usage');
    assert.ok(usage);
    assert.equal(usage.textContent, 'Tokens: 1,801 (1,234 prompt · 567 answer)');
    assert.doesNotMatch(usage.textContent, /context window/i);
});
