// pg is a user-installed optional dependency, not bundled
declare module 'pg' {
  const pg: any;
  export default pg;
  export const Pool: any;
  export const Client: any;
}
