import React, { useEffect, useRef, useState } from 'react';
import Quill from 'quill';
import { uploadBlogImage } from '../utils/uploadBlogImage';
import 'quill/dist/quill.snow.css';

const IMG_STYLE = 'width:100%;max-width:100%;height:auto;border-radius:8px;margin:16px 0;';

const BaseImage = Quill.import('formats/image');

class StyledImage extends BaseImage {
  static create(value) {
    const node = super.create(value);
    node.setAttribute('style', IMG_STYLE);
    return node;
  }

  static formats(domNode) {
    const formats = super.formats(domNode) || {};
    const style = domNode.getAttribute('style');
    if (style) formats.style = style;
    return formats;
  }

  format(name, value) {
    if (name === 'style') {
      if (value) this.domNode.setAttribute('style', value);
      else this.domNode.removeAttribute('style');
      return;
    }
    super.format(name, value);
  }
}

Quill.register({ 'formats/image': StyledImage }, true);

function applyImageStyles(root) {
  if (!root) return;
  root.querySelectorAll('img').forEach((img) => {
    if (!img.getAttribute('style')) img.setAttribute('style', IMG_STYLE);
  });
}

export default function BlogQuillEditor({ value, onChange, onError }) {
  const wrapRef = useRef(null);
  const toolbarRef = useRef(null);
  const editorRef = useRef(null);
  const quillRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const onErrorRef = useRef(onError);
  const [htmlMode, setHtmlMode] = useState(false);
  const [htmlSource, setHtmlSource] = useState(value || '');
  const [uploading, setUploading] = useState(false);

  onChangeRef.current = onChange;
  onErrorRef.current = onError;

  const pickAndInsertImage = (quill) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/gif,image/webp';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      setUploading(true);
      try {
        const url = await uploadBlogImage(file);
        const range = quill.getSelection(true) || { index: quill.getLength(), length: 0 };
        quill.insertEmbed(range.index, 'image', url, 'user');
        const [leaf] = quill.getLeaf(range.index);
        if (leaf && leaf.domNode && leaf.domNode.setAttribute) {
          leaf.domNode.setAttribute('style', IMG_STYLE);
        }
        quill.setSelection(range.index + 1, 0, 'user');
      } catch (err) {
        if (onErrorRef.current) onErrorRef.current(err?.message || 'Image upload failed.');
      } finally {
        setUploading(false);
      }
    };
    input.click();
  };

  useEffect(() => {
    if (!editorRef.current || quillRef.current) return undefined;

    const quill = new Quill(editorRef.current, {
      theme: 'snow',
      placeholder: 'Write the post…',
      modules: {
        toolbar: {
          container: toolbarRef.current,
          handlers: {
            image() {
              pickAndInsertImage(quill);
            },
          },
        },
      },
    });

    quill.root.innerHTML = value || '';
    applyImageStyles(quill.root);

    quill.on('text-change', () => {
      applyImageStyles(quill.root);
      const html = quill.root.innerHTML;
      setHtmlSource(html);
      if (onChangeRef.current) onChangeRef.current(html);
    });

    quillRef.current = quill;
    return () => {
      quill.off('text-change');
      quillRef.current = null;
    };
    // Mount once; parent remounts this component when the selected post changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleHtmlMode = () => {
    const quill = quillRef.current;
    if (!quill) {
      setHtmlMode((v) => !v);
      return;
    }
    if (!htmlMode) {
      setHtmlSource(quill.root.innerHTML);
      setHtmlMode(true);
      return;
    }
    quill.root.innerHTML = htmlSource;
    applyImageStyles(quill.root);
    const html = quill.root.innerHTML;
    if (onChangeRef.current) onChangeRef.current(html);
    setHtmlMode(false);
  };

  const handleHtmlChange = (next) => {
    setHtmlSource(next);
    if (onChangeRef.current) onChangeRef.current(next);
  };

  return (
    <div className={`blog-quill ${htmlMode ? 'html-mode' : ''}`} ref={wrapRef}>
      <div ref={toolbarRef} className="blog-quill-toolbar">
        <span className="ql-formats">
          <button type="button" className="ql-bold" />
          <button type="button" className="ql-italic" />
          <button type="button" className="ql-underline" />
        </span>
        <span className="ql-formats">
          <button type="button" className="ql-header" value="2" />
        </span>
        <span className="ql-formats">
          <button type="button" className="ql-list" value="ordered" />
          <button type="button" className="ql-list" value="bullet" />
          <button type="button" className="ql-blockquote" />
        </span>
        <span className="ql-formats">
          <button type="button" className="ql-link" />
          <button type="button" className="ql-image" />
          <button type="button" className="ql-clean" />
        </span>
        <span className="ql-formats">
          <button
            type="button"
            className={`ql-html-toggle${htmlMode ? ' active' : ''}`}
            title="HTML source"
            onClick={toggleHtmlMode}
          >
            {'</>'}
          </button>
        </span>
        {uploading && <span className="blog-quill-uploading">Uploading image…</span>}
      </div>
      <div ref={editorRef} className="blog-quill-surface" />
      {htmlMode && (
        <textarea
          className="form-textarea blog-html-source"
          value={htmlSource}
          onChange={(e) => handleHtmlChange(e.target.value)}
          spellCheck={false}
        />
      )}
    </div>
  );
}
