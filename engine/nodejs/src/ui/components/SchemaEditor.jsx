// Schema editor for Data Objects and Events — a thin wrapper over the universal
// ShapeEditor (contour.md §3.3). It adds the two things specific to a Data
// Object / Event schema: the "Link to an existing spec" tab (AsyncAPI / JSON
// Schema / Avro) and, for Data Objects, named nested-type definitions. A Data
// Object / Event schema may reference any Data Object (no component scoping),
// so refScopeIds is left null. Binds to el.schema; every edit calls onChange.
import { ShapeEditor } from "./ShapeEditor.jsx";

export function SchemaEditor({ kind, schema, ownerId, world, onChange }) {
  return (
    <ShapeEditor
      schema={schema}
      ownerId={ownerId}
      world={world}
      onChange={onChange}
      title={kind === "DataObject" ? "Schema: the fields it holds" : "Schema: what the event carries"}
      fieldsTitle={kind === "DataObject" ? "Fields" : "Payload fields"}
      allowLink
      allowNested={kind === "DataObject"}
      refScopeIds={null}
    />
  );
}
