import React from 'react';
import PipelineChecklist from './PipelineChecklist';
import { PWA_PIPELINE } from '../data/pwaPipeline';

export default function PWAPipelineChecklist({ project }) {
  return (
    <PipelineChecklist
      projectId={project?.id}
      pipelineDocId="pwa"
      data={PWA_PIPELINE}
    />
  );
}
