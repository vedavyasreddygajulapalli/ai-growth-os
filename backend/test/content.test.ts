import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {editDto,renderBlocks} from '../src/content/contracts';
import {seal,unseal,cmsError} from '../src/content/wordpress';
import {publicationMarker} from '../src/content/publishing';
test('content accepts structured text, escapes active markup and rejects extra fields',()=>{
 const d=editDto.parse({title:'Example',slug:'example',type:'post',blocks:[{type:'paragraph',text:'<script>alert(1)</script>'},{type:'heading',level:3,text:'A & B'}]});
 assert.equal(renderBlocks(d.blocks),'<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>\n<h3>A &amp; B</h3>');
 assert.equal(editDto.safeParse({...d,orgId:'override'}).success,false);
 assert.equal(editDto.safeParse({...d,blocks:[{type:'html',text:'raw'}]}).success,false);
});
test('WordPress credentials are encrypted and cannot move across tenants or websites',()=>{
 process.env.CMS_ENCRYPTION_KEY=randomBytes(32).toString('base64');const encrypted=seal('private-application-password','org:site');
 assert.ok(!encrypted.includes('private'));assert.equal(unseal(encrypted,'org:site'),'private-application-password');
 assert.throws(()=>unseal(encrypted,'org:other'));assert.throws(()=>unseal(encrypted+'x','org:site'));
 assert.equal(cmsError(Error('secret-provider-response')),'CMS_REQUEST_FAILED');
});
test('reconciliation markers distinguish approved revisions',()=>{assert.notEqual(publicationMarker('a',1),publicationMarker('a',2));});
import {importWordPress} from '../src/content/import';
test('WordPress import strips executable markup and preserves supported block order',()=>{
 const d=importWordPress({title:{raw:'Imported'},slug:'imported',content:{raw:'<h1>Heading</h1><p>Hello <strong>world</strong></p><script>attack()</script><ul><li>One</li><li>Two</li></ul>'}},'post');assert.deepEqual(d.blocks,[{type:'heading',level:2,text:'Heading'},{type:'paragraph',text:'Hello world'},{type:'list',text:'One\nTwo'}]);assert.ok(!renderBlocks(d.blocks).includes('attack'));
});
