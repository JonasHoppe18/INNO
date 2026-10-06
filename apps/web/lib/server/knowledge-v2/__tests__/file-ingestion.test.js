import { it, expect } from 'vitest';
import { extractFileSource, MAX_KNOWLEDGE_FILE_BYTES } from '../file-ingestion';
const bytes = text => new TextEncoder().encode(text);
function pdf(text) {
 const stream=`BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let doc='%PDF-1.4\n',offsets=[0];
 for(let i=0;i<objects.length;i++){offsets.push(doc.length);doc+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
 const start=doc.length;doc+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
 return bytes(doc);
}
it('preserves TXT source bytes and ordered text without generating knowledge',async()=>{
 const raw=bytes('\uFEFF## Intake\r\n1. Obtain a photo.\r\n2. Submit for assessment.\r\n');
 const r=await extractFileSource({fileName:'guide.txt',mimeType:'text/plain',rawBytes:raw});
 expect(r.canonicalText).toBe('## Intake\n1. Obtain a photo.\n2. Submit for assessment.');expect(r.rawBytes).toBe(raw);expect(r).toMatchObject({title:'guide',kind:'text',pageCount:null,sizeBytes:raw.length});
});
it('extracts a real one-page PDF and retains original bytes',async()=>{
 const raw=pdf('Approved source statement.'),copy=Uint8Array.from(raw);
 const r=await extractFileSource({fileName:'guide.pdf',mimeType:'application/pdf',rawBytes:raw});
 expect(r.canonicalText).toContain('Approved source statement.');expect(r.pageCount).toBe(1);expect(r.rawBytes).toEqual(copy);expect(r.kind).toBe('pdf');
});
for(const [name,input,code] of [
 ['unsupported file',{fileName:'image.png',rawBytes:bytes('text')},'file_type_unsupported'],
 ['mismatched MIME',{fileName:'guide.txt',mimeType:'application/pdf',rawBytes:bytes('text')},'file_type_mismatch'],
 ['PDF signature missing',{fileName:'guide.pdf',rawBytes:bytes('not a PDF')},'file_type_mismatch'],
 ['corrupt PDF',{fileName:'guide.pdf',rawBytes:bytes('%PDF-broken')},'file_invalid_pdf'],
 ['empty file',{fileName:'guide.txt',rawBytes:new Uint8Array()},'file_empty'],
 ['invalid UTF8',{fileName:'guide.txt',rawBytes:new Uint8Array([255])},'file_encoding_unsupported'],
 ['binary TXT',{fileName:'guide.txt',rawBytes:new Uint8Array([0,1,2])},'file_binary_text'],
 ['oversized file',{fileName:'guide.txt',rawBytes:new Uint8Array(MAX_KNOWLEDGE_FILE_BYTES+1)},'file_too_large'],
 ['blank source',{fileName:'guide.txt',rawBytes:bytes(' \n ')},'file_no_text'],
]) it(`rejects ${name}`,async()=>{await expect(extractFileSource(input)).rejects.toMatchObject({code});});
