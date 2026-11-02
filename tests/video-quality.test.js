const {test}=require('node:test'),assert=require('node:assert/strict');

const {normalizeVideoQuality}=require('../src/video-quality');

test('old configs select quality mode and retain a usable manual bitrate',()=>{
 assert.deepEqual(normalizeVideoQuality({}),{qualityMode:'quality',videoBitrate:60});
 assert.deepEqual(normalizeVideoQuality(null),{qualityMode:'quality',videoBitrate:60});
});

test('manual bitrate accepts the full supported integer range without rounding',()=>{
 for(const bitrate of [5,6,60,100,249,250])assert.deepEqual(normalizeVideoQuality({qualityMode:'bitrate',videoBitrate:bitrate}),{qualityMode:'bitrate',videoBitrate:bitrate});
});

test('malformed settings cannot reach the native encoder as unsafe values',()=>{
 for(const videoBitrate of [undefined,null,'60',true,0,4,251,59.5,NaN,Infinity,-Infinity,Number.MAX_SAFE_INTEGER])assert.deepEqual(normalizeVideoQuality({qualityMode:'bitrate',videoBitrate}),{qualityMode:'bitrate',videoBitrate:60});
 for(const qualityMode of [null,'CQP','BITRATE','',true,7])assert.deepEqual(normalizeVideoQuality({qualityMode,videoBitrate:120}),{qualityMode:'quality',videoBitrate:120});
});

test('normalizing quality settings leaves unrelated settings and the original object untouched',()=>{
 const config=Object.freeze({qualityMode:'quality',videoBitrate:125,duration:120});
 assert.deepEqual(normalizeVideoQuality(config),{qualityMode:'quality',videoBitrate:125});
 assert.equal(config.duration,120);
});
