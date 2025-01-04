export function isHddStaticServiceConfigured() {
  return !process.env.STATIC_SERVICE || process.env.STATIC_SERVICE === 'hdd';
}

export function isS3ServiceConfigured() {
  return !process.env.STATIC_SERVICE || process.env.STATIC_SERVICE === 's3';
}
