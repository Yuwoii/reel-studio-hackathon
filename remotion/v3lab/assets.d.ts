// webpack asset/resource modules (Remotion's bundler rule for png/jpg) resolve to a URL string.
declare module "*.png" {
  const url: string;
  export default url;
}
declare module "*.jpg" {
  const url: string;
  export default url;
}
