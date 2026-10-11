const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

class FakeElement {
    constructor(tagName) {
        this.tagName = tagName;
        this.children = [];
        this.attributes = {};
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
    const { renderStreamDetails } = await import(moduleUrl);
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
    assert.deepEqual(links.map(link => link.children[0].textContent), [
        'First article',
        'Second article',
    ]);
});
