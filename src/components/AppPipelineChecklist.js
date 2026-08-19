import React from 'react';
import PipelineChecklist from './PipelineChecklist';
import { APP_PIPELINE } from '../data/appPipeline';

export default function AppPipelineChecklist({ project }) {
  return (
    <PipelineChecklist
      projectId={project?.id}
      pipelineDocId="app"
      data={APP_PIPELINE}
    />
  );
}
