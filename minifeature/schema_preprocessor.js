/*
utility script for auto generating some schema stuff so I don't go insane
*/


const fs = require("fs");
const path = require("path");

const template_path = "./schema_templates";
const schema_path = "./schemas";

function forEachFile(directory, fn, recursive=false){
  let files = fs.readdirSync(directory);
  
  files.forEach((file) => {
    const filePath = path.join(directory, file);
    const stat = fs.statSync(filePath);
    if (recursive && stat.isDirectory()) {
      forEachFile(filePath, fn, max_depth, depth + 1);
    } else if (stat.isFile()) {
      const data = fs.readFileSync(filePath, "utf8");
      fn(data, file);
    }
  });
}

function preprocess(schema){
    if (schema.properties){
        for (const key in schema.properties) {
            schema.properties[key] = preprocess(schema.properties[key]);
        }
    }
    if (schema.patternProperties){
        for (const key in schema.patternProperties) {
            schema.patternProperties[key] = preprocess(schema.patternProperties[key]);
        }
    }
    if (schema.items){
        if (Array.isArray(schema.items)){
            for (let i = 0; i < schema.items.length; i++){
                schema.items[i] = preprocess(schema.items[i]);
            }
        } else {
            schema.items = preprocess(schema.items);
        }
    }
    if (schema.anyOf){
        for (let i = 0; i < schema.anyOf.length; i++){
            schema.anyOf[i] = preprocess(schema.anyOf[i]);
        }
    }

    if (schema.variable){
        return {
            anyOf: [
                schema,
                { "$ref": "variable.schema.json" }
            ]
        };
    } else {
        return schema;
    }
}

forEachFile(template_path, (data, file) => {
    let fd = fs.openSync(`${schema_path}/${file}`, 'w');
    fs.writeSync(fd, JSON.stringify(preprocess(JSON.parse(data)), null, 4));
    fs.closeSync(fd);
});